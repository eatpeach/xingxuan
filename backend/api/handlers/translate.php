<?php

/**
 * 品名翻译（20261113）：发票 / 报价单选印尼语、英文时，品名和规格要用建材五金的行业叫法。
 *
 * 1. 整个品名在术语表里 → 直接用（status=glossary）
 * 2. 否则交给 AI：要求按印尼建材店（toko bangunan）的实际叫法翻，品牌 / 型号 / 尺寸原样保留，
 *    并把术语表里相关的词一起给它参考（status=ai，待人工确认）
 * 3. 人工在对照表里逐行核对、改正后确认（status=confirmed），可顺手存进术语表，下次直接命中
 * 开印尼语 / 英文发票前，所有行必须是 glossary 或 confirmed（前端把关；打印页也会提示）。
 */

function _transLangCols(string $lang): array
{
    if ($lang === 'en') return ['name_en', 'spec_en', 'trans_en_status', 'en_text'];
    return ['name_id', 'spec_id', 'trans_id_status', 'id_text'];
}

function _glossaryMap(PDO $pdo, string $col): array
{
    $map = [];
    foreach ($pdo->query("SELECT zh, {$col} AS t FROM term_glossary WHERE {$col} != ''")->fetchAll() as $r) {
        $map[trim((string) $r['zh'])] = (string) $r['t'];
    }
    // 长词优先，保证「防水石膏板」先于「石膏板」命中
    uksort($map, fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
    return $map;
}

function _transSystemPrompt(string $lang): string
{
    if ($lang === 'en') {
        return "You translate Chinese building-material / hardware product names into professional English used in construction trade quotations.\n"
            . "Rules:\n- Use the standard trade term (e.g. 竖骨 = Metal Stud, 天地骨 = Metal Track, 炮钉 = Concrete Shot Nail), never a word-by-word literal translation.\n"
            . "- Keep brand names, model numbers, sizes, standards (SNI/GB), numbers and units exactly as given.\n"
            . "- If a GLOSSARY term appears inside the name, you MUST use the glossary translation for that part.\n"
            . "- Translate the spec too (e.g. 100个/盒 = 100 pcs/box, 国标 = GB standard); keep measurements unchanged.\n"
            . "- NEVER change technical grades / classes / standards / types: 超五类 = Cat5e (NOT Cat6), 六类 = Cat6, 国标 = GB standard, 平方 (cable) = mm². Every number in the source must appear in the translation.\n"
            . "- 各 = each (e.g. 红蓝线各200米 = red & blue, 200 m each).\n"
            . "- If you are not sure what the product or its technical grade is, still give your best trade term and set confidence to \"low\" with a short Chinese note explaining why.\n"
            . 'Return JSON: {"items":[{"i":<index>,"name":"...","spec":"...","confidence":"high|low","note":"中文说明，可空"}]}';
    }
    return "Anda menerjemahkan nama produk bahan bangunan / perkakas (hardware) dari bahasa Mandarin ke bahasa Indonesia yang dipakai di toko bangunan, proyek, dan penawaran harga supplier di Indonesia.\n"
        . "Aturan:\n- Pakai istilah dagang yang lazim di Indonesia, BUKAN terjemahan kata per kata. Contoh: 竖骨 = Metal Stud, 天地骨 = Metal Track, 炮钉 = Paku Tembak, 膨胀螺丝 = Dynabolt, 暗装接线盒 = Inbow Dus, 石膏板 = Papan Gypsum, 方管 = Besi Hollow, 钢筋 = Besi Beton.\n"
        . "- Istilah serapan yang memang dipakai di lapangan (Metal Stud, Wiremesh, Sealant, MCB, Elbow, Reducer, Ball Valve) boleh tetap bahasa Inggris.\n"
        . "- Merek, tipe / model, ukuran, standar (SNI/GB), angka dan satuan dipertahankan persis.\n"
        . "- Jika ada istilah dari GLOSARIUM di dalam nama, WAJIB pakai terjemahan glosarium untuk bagian itu.\n"
        . "- Spesifikasi juga diterjemahkan (contoh: 100个/盒 = isi 100 pcs/box, 国标 = standar GB, 加厚 = tebal); ukuran tidak diubah.\n"
        . "- JANGAN PERNAH mengubah grade / kelas / standar / tipe teknis: 超五类 = Cat5e (BUKAN Cat6), 六类 = Cat6, 国标 = standar GB, 平方 (kabel) = mm², 2×2.5平方 = 2x2,5 mm². Semua angka di sumber harus muncul di terjemahan.\n"
        . "- 各 = masing-masing (contoh: 红蓝线各200米 = Merah & Biru masing-masing 200 m).\n"
        . "- Kalau tidak yakin produk apa atau grade teknisnya, tetap beri istilah terbaik dan set confidence \"low\" dengan note singkat berbahasa Mandarin.\n"
        . 'Kembalikan JSON: {"items":[{"i":<index>,"name":"...","spec":"...","confidence":"high|low","note":"中文说明，可空"}]}';
}

/** AI 翻译一批明细；返回 [index => [name, spec, confidence, note]] */
function _transByAi(PDO $pdo, array $rows, string $lang, array $glossary): array
{
    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('还没配置 AI（系统设置 → AI），只能用术语表或手动填写译名');
    // 只把和这批品名相关的术语给 AI，避免提示词过长
    $related = [];
    foreach ($rows as $r) {
        $text = $r['product_name'] . ' ' . $r['spec'];
        foreach ($glossary as $zh => $t) {
            if (mb_strpos($text, $zh) !== false) $related[$zh] = $t;
        }
    }
    $glossText = $related ? implode("\n", array_map(fn ($zh, $t) => "{$zh} = {$t}", array_keys($related), $related)) : '(无)';
    $list = [];
    foreach ($rows as $i => $r) {
        $list[] = ['i' => $i, 'name' => $r['product_name'], 'spec' => $r['spec'], 'unit' => $r['unit']];
    }
    $resp = _aiCallOpenAI($cfg, [
        ['role' => 'system', 'content' => _transSystemPrompt($lang)],
        ['role' => 'user', 'content' => "GLOSSARY / GLOSARIUM:\n{$glossText}\n\nITEMS:\n" . json_encode($list, JSON_UNESCAPED_UNICODE)],
    ], ['max_tokens' => 8000]);
    $parsed = _aiDecodeJson($resp);
    $out = [];
    foreach ((array) ($parsed['items'] ?? []) as $it) {
        if (!isset($it['i'])) continue;
        $out[(int) $it['i']] = [
            'name' => trim((string) ($it['name'] ?? '')),
            'spec' => trim((string) ($it['spec'] ?? '')),
            'confidence' => ($it['confidence'] ?? 'high') === 'low' ? 'low' : 'high',
            'note' => trim((string) ($it['note'] ?? '')),
        ];
    }
    return $out;
}

/** 原文里有、译文里没有的数字（小数点 / 逗号写法都认：2.5 = 2,5） */
function _transMissingNumbers(string $src, string $dst): array
{
    preg_match_all('/\d+(?:[.,]\d+)?/', $src, $m1);
    preg_match_all('/\d+(?:[.,]\d+)?/', $dst, $m2);
    $have = array_map(fn ($x) => str_replace(',', '.', $x), $m2[0]);
    $miss = [];
    foreach (array_unique($m1[0]) as $n) {
        if (!in_array(str_replace(',', '.', $n), $have, true)) $miss[] = $n;
    }
    return $miss;
}

/** 品名里出现的术语，译文没用术语表叫法的列出来（长词优先，短词被长词覆盖时不重复报） */
function _transGlossaryMisses(string $zh, string $translated, array $glossary): array
{
    $out = [];
    $covered = '';
    foreach ($glossary as $term => $t) {
        if (mb_strlen($term) < 2 || mb_strpos($zh, $term) === false || mb_strpos($covered, $term) !== false) continue;
        $covered .= '|' . $term;
        $core = trim(preg_replace('/\s*\(.*?\)\s*/u', ' ', $t));
        if ($core !== '' && mb_stripos($translated, $core) === false) $out[] = "术语表「{$term} = {$t}」";
    }
    return $out;
}

function _transItemRows(PDO $pdo, int $qid): array
{
    $st = $pdo->prepare("SELECT id, product_name, spec, unit, name_id, spec_id, trans_id_status, name_en, spec_en, trans_en_status
        FROM customer_quote_items WHERE quote_id = ? ORDER BY id");
    $st->execute([$qid]);
    return $st->fetchAll();
}

/**
 * 给报价单明细出译名。force=1 时连已有译名（未确认的）也重新翻；人工确认过的永远不覆盖。
 */
function handle_translateQuoteItems(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $lang = ($input['lang'] ?? '') === 'en' ? 'en' : 'id';
    [$nameCol, $specCol, $statusCol, $glossCol] = _transLangCols($lang);
    $rows = _transItemRows($pdo, $qid);
    if (!$rows) jsonError('报价单没有明细');
    $force = !empty($input['force']);
    $glossary = _glossaryMap($pdo, $glossCol);

    $todo = [];
    $up = $pdo->prepare("UPDATE customer_quote_items SET {$nameCol} = ?, {$specCol} = ?, {$statusCol} = ? WHERE id = ?");
    $notes = [];
    foreach ($rows as $r) {
        $status = (string) $r[$statusCol];
        if ($status === 'confirmed') continue;
        if (!$force && $status !== '' && trim((string) $r[$nameCol]) !== '') continue;
        $zh = trim((string) $r['product_name']);
        $specZh = trim((string) $r['spec']);
        // 整个品名命中术语表，且规格里没有需要翻的中文 → 直接用术语表
        if (isset($glossary[$zh]) && !preg_match('/\p{Han}/u', $specZh)) {
            $up->execute([$glossary[$zh], $specZh, 'glossary', (int) $r['id']]);
            continue;
        }
        $todo[] = $r;
    }
    if ($todo) {
        $ai = _transByAi($pdo, $todo, $lang, $glossary);
        foreach ($todo as $i => $r) {
            $t = $ai[$i] ?? null;
            if (!$t || $t['name'] === '') continue;
            $up->execute([$t['name'], $t['spec'], 'ai', (int) $r['id']]);
            $warn = [];
            if ($t['confidence'] === 'low') $warn[] = '【AI 不确定】' . $t['note'];
            elseif ($t['note'] !== '') $warn[] = $t['note'];
            // 数字自检：原文里的每个数字（规格、长度、数量、等级）都必须出现在译文里
            $miss = _transMissingNumbers($r['product_name'] . ' ' . $r['spec'], $t['name'] . ' ' . $t['spec']);
            if ($miss) $warn[] = '【数字对不上】原文里的 ' . implode('、', $miss) . ' 没出现在译文里，请核对';
            // 译文里不该还有中文
            if (preg_match('/\p{Han}/u', $t['name'] . $t['spec'])) $warn[] = '【还有中文】译文里还留着中文没翻';
            // 品名里含术语表的词，译文必须用术语表的叫法（取括号前的主体比对，不分大小写）
            $off = _transGlossaryMisses($r['product_name'], $t['name'], $glossary);
            if ($off) $warn[] = '【没按术语表】' . implode('；', $off);
            if ($warn) $notes[(int) $r['id']] = implode(' ', $warn);
        }
    }
    $out = _transItemRows($pdo, $qid);
    foreach ($out as &$r) $r['ai_note'] = $notes[(int) $r['id']] ?? '';
    unset($r);
    jsonOk(['items' => $out, 'lang' => $lang]);
}

/** 人工确认译名；learn=1 时把「中文品名 → 译名」存进术语表 */
function handle_saveQuoteItemTranslations(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $lang = ($input['lang'] ?? '') === 'en' ? 'en' : 'id';
    [$nameCol, $specCol, $statusCol, $glossCol] = _transLangCols($lang);
    $items = (array) ($input['items'] ?? []);
    $learn = !empty($input['learn']);
    $up = $pdo->prepare("UPDATE customer_quote_items SET {$nameCol} = ?, {$specCol} = ?, {$statusCol} = 'confirmed' WHERE id = ? AND quote_id = ?");
    $sel = $pdo->prepare("SELECT product_name FROM customer_quote_items WHERE id = ? AND quote_id = ?");
    // 不用 ON CONFLICT（服务器 SQLite 版本老），先查再改 / 插
    $glossFind = $pdo->prepare("SELECT id FROM term_glossary WHERE zh = ?");
    $glossUpd = $pdo->prepare("UPDATE term_glossary SET {$glossCol} = ?, updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?");
    $glossIns = $pdo->prepare("INSERT INTO term_glossary (zh, {$glossCol}, source, updated_by) VALUES (?, ?, 'confirmed', ?)");
    $n = 0;
    $learned = 0;
    foreach ($items as $it) {
        $name = trim((string) ($it['name'] ?? ''));
        if ($name === '') jsonError('还有品名没填译名，不能确认');
        $up->execute([$name, trim((string) ($it['spec'] ?? '')), (int) ($it['id'] ?? 0), $qid]);
        if ($up->rowCount() === 0) continue;
        $n++;
        if ($learn) {
            $sel->execute([(int) $it['id'], $qid]);
            $zh = trim((string) $sel->fetchColumn());
            if ($zh !== '' && mb_strlen($zh) <= 40) {
                $glossFind->execute([$zh]);
                $gid = (int) $glossFind->fetchColumn();
                if ($gid) $glossUpd->execute([$name, (int) $user['id'], $gid]);
                else $glossIns->execute([$zh, $name, (int) $user['id']]);
                $learned++;
            }
        }
    }
    opLog($pdo, 'customer_quote', $qid, 'confirm_translation', "{$lang} {$n} 行，入术语表 {$learned}", (int) $user['id']);
    jsonOk(['confirmed' => $n, 'learned' => $learned]);
}

function handle_listGlossary(PDO $pdo, array $input): void
{
    $kw = trim((string) ($input['keyword'] ?? ''));
    if ($kw !== '') {
        $st = $pdo->prepare("SELECT * FROM term_glossary WHERE zh LIKE ? OR id_text LIKE ? OR en_text LIKE ? ORDER BY zh");
        $like = "%{$kw}%";
        $st->execute([$like, $like, $like]);
    } else {
        $st = $pdo->query("SELECT * FROM term_glossary ORDER BY updated_at DESC, zh");
    }
    jsonOk(['items' => $st->fetchAll()]);
}

function handle_saveGlossaryTerm(PDO $pdo, array $input, array $user): void
{
    $zh = trim((string) ($input['zh'] ?? ''));
    if ($zh === '') jsonError('请填写中文');
    $idText = trim((string) ($input['id_text'] ?? ''));
    $enText = trim((string) ($input['en_text'] ?? ''));
    if ($idText === '' && $enText === '') jsonError('印尼语和英文至少填一个');
    $id = (int) ($input['id'] ?? 0);
    if ($id) {
        $pdo->prepare("UPDATE term_glossary SET zh = ?, id_text = ?, en_text = ?, note = ?, source = 'manual', updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            ->execute([$zh, $idText, $enText, trim((string) ($input['note'] ?? '')), (int) $user['id'], $id]);
    } else {
        $st = $pdo->prepare("SELECT id FROM term_glossary WHERE zh = ?");
        $st->execute([$zh]);
        if ($st->fetchColumn()) jsonError("「{$zh}」已经在术语表里了，直接改那一条");
        $pdo->prepare("INSERT INTO term_glossary (zh, id_text, en_text, note, source, updated_by) VALUES (?, ?, ?, ?, 'manual', ?)")
            ->execute([$zh, $idText, $enText, trim((string) ($input['note'] ?? '')), (int) $user['id']]);
    }
    jsonOk();
}

function handle_deleteGlossaryTerm(PDO $pdo, array $input, array $user): void
{
    if (($user['role'] ?? '') !== 'admin') jsonError('只有管理员能删除术语', 403);
    $pdo->prepare("DELETE FROM term_glossary WHERE id = ?")->execute([(int) ($input['id'] ?? 0)]);
    jsonOk();
}
