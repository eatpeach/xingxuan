<?php

/**
 * 物品翻译（20261113）：发票 / 报价单选印尼语、英文时，物品名、规格、品牌、型号必须全部是目标语言，
 * 用建材五金的行业叫法，不是直译。
 *
 * 1. 物品名整条命中术语表、且规格 / 品牌 / 型号都不需要翻（纯数字尺寸代码）→ 直接用（status=glossary）
 * 2. 否则交给 AI：物品名按印尼建材店（toko bangunan）实际叫法；规格里的中文和英文单词翻成目标语言，
 *    尺寸 / 型号代码 / 标准号原样保留；中国品牌用官方国际名称，没有就用拼音（status=ai，待人工确认）
 * 3. 人工在对照表里逐行核对、改正后确认（status=confirmed）。确认时强制检查：不能留一个中文字，
 *    原来有规格 / 品牌 / 型号的，译文不能是空的
 * 开印尼语 / 英文发票前必须全部确认；发票页上只要还有中文就禁止导出。
 */

function _transCols(string $lang): array
{
    $s = $lang === 'en' ? 'en' : 'id';
    return [
        'name' => "name_{$s}", 'spec' => "spec_{$s}", 'brand' => "brand_{$s}", 'model' => "model_{$s}",
        'status' => "trans_{$s}_status", 'gloss' => "{$s}_text",
    ];
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

/**
 * 这段文字需不需要翻：有中文，或有成词的字母（≥3 个连续字母，如 CABLE、Length、YJV）就交给 AI 判断；
 * 纯数字、尺寸、符号、短单位（mm、m、kg、DN50、M14）不用翻
 */
function _transNeeds(string $s): bool
{
    $s = trim($s);
    if ($s === '') return false;
    return (bool) preg_match('/\p{Han}|[A-Za-z]{3,}/u', $s);
}

function _transSystemPrompt(string $lang): string
{
    if ($lang === 'en') {
        return "You translate Chinese building-material / hardware order lines into professional English used in construction trade invoices. EVERYTHING you output must be English — no Chinese characters may remain.\n"
            . "Rules:\n- name: use the standard trade term (e.g. 竖骨 = Metal Stud, 天地骨 = Metal Track, 炮钉 = Concrete Shot Nail), never word-by-word literal translation.\n"
            . "- If a GLOSSARY term appears in the name, you MUST use the glossary translation for that part.\n"
            . "- spec: translate every Chinese word and every non-English word into English (e.g. 100个/盒 = 100 pcs/box, 国标 = GB standard, 外径 = OD, 长度5米 = length 5 m, 两侧接头一样 = same connector on both ends, 蓝色 = blue). Keep measurements, model codes, standard numbers (DN50, PN10, YJV 3*2.5, M14, Φ150) exactly.\n"
            . "- Units inside spec: 包 / 袋 = bag, 根 / 支 / 条 = pcs (length), 张 / 片 = sheet, 个 / 件 = pcs, 套 = set, 箱 = carton, 盒 = box, 桶 = pail, 卷 = roll, 瓶 = bottle, 对 = pair, 米 = m.\n"
            . "- brand: Chinese brands use their official international name (海螺 = Conch, 联塑 = Lesso, 公牛 = BULL, 正泰 = CHINT, 德力西 = DELIXI, 东方雨虹 = Oriental Yuhong, 北新 = BNBM, 立邦 = Nippon Paint); if unknown, write Hanyu Pinyin in capitals and set confidence low. Latin brands stay as is.\n"
            . "- model: keep codes; translate any Chinese words in it (YJJH连接条 = YJJH Connecting Strip).\n"
            . "- NEVER change technical grades / classes / standards / types: 超五类 = Cat5e (NOT Cat6), 六类 = Cat6, 平方 (cable) = mm². Every number in the source must appear in the translation.\n"
            . "- 各 = each (e.g. 红蓝线各200米 = red & blue, 200 m each).\n"
            . "- If unsure about the product, a grade, or a brand, still give your best answer and set confidence \"low\" with a short Chinese note.\n"
            . 'Return JSON: {"items":[{"i":<index>,"name":"...","spec":"...","brand":"...","model":"...","confidence":"high|low","note":"中文说明，可空"}]} (brand / model empty string if the input had none)';
    }
    return "Anda menerjemahkan baris pesanan bahan bangunan / perkakas (hardware) dari bahasa Mandarin ke bahasa Indonesia yang dipakai di toko bangunan, proyek, dan faktur supplier di Indonesia. SEMUA keluaran harus bahasa Indonesia — tidak boleh ada satu huruf Mandarin pun yang tersisa.\n"
        . "Aturan:\n- name: pakai istilah dagang yang lazim di Indonesia, BUKAN terjemahan kata per kata. Contoh: 竖骨 = Metal Stud, 天地骨 = Metal Track, 炮钉 = Paku Tembak, 膨胀螺丝 = Dynabolt, 暗装接线盒 = Inbow Dus, 石膏板 = Papan Gypsum, 方管 = Besi Hollow, 钢筋 = Besi Beton.\n"
        . "- Istilah serapan yang memang dipakai di lapangan Indonesia (Metal Stud, Wiremesh, Sealant, MCB, Elbow, Reducer, Ball Valve, Dynabolt) boleh tetap.\n"
        . "- Jika ada istilah dari GLOSARIUM di dalam nama, WAJIB pakai terjemahan glosarium untuk bagian itu.\n"
        . "- spec: terjemahkan SEMUA kata Mandarin dan kata bahasa Inggris biasa ke bahasa Indonesia (contoh: 100个/盒 = isi 100 pcs/box, 国标 = standar GB, 外径 = diameter luar, 长度5米 = panjang 5 m, 两侧接头一样 = sambungan kedua sisi sama, 蓝色 = biru, HDMI CABLE 4K 15M = Kabel HDMI 4K 15 m, Length = Panjang). Ukuran, kode tipe, nomor standar (DN50, PN10, YJV 3*2.5, M14, Φ150, SNI) dipertahankan persis.\n"
        . "- Satuan di dalam spec WAJIB pakai istilah Indonesia, bukan bahasa Inggris: 包 / 袋 = sak (40kg/包 = 40 kg/sak), 根 / 支 / 条 = batang, 张 / 片 = lembar, 个 / 件 = pcs, 只 / 块 = buah, 套 = set, 箱 = dus, 盒 = box, 桶 = pail, 卷 = roll, 瓶 = botol, 对 = pasang, 米 = m. JANGAN pakai pack, piece, sheet, carton, bag.\n"
        . "- brand: merek Tiongkok pakai nama internasional resminya (海螺 = Conch, 联塑 = Lesso, 公牛 = BULL, 正泰 = CHINT, 德力西 = DELIXI, 东方雨虹 = Oriental Yuhong, 北新 = BNBM, 立邦 = Nippon Paint); kalau tidak tahu, tulis Hanyu Pinyin huruf kapital dan set confidence low. Merek berhuruf Latin tetap.\n"
        . "- model: kode dipertahankan; kata Mandarin di dalamnya diterjemahkan (YJJH连接条 = YJJH Strip Penyambung, NYA 1*4 蓝色 = NYA 1*4 Biru).\n"
        . "- JANGAN PERNAH mengubah grade / kelas / standar / tipe teknis: 超五类 = Cat5e (BUKAN Cat6), 六类 = Cat6, 平方 (kabel) = mm². Semua angka di sumber harus muncul di terjemahan.\n"
        . "- Ikuti tata bahasa Indonesia: kata benda dulu, sifat / warna di belakang (亮白色 = Putih Terang, 加厚镀锌管 = Pipa Galvanis Tebal, 黑色 = Hitam). Warna: 白色 = Putih, 黑色 = Hitam, 红色 = Merah, 蓝色 = Biru, 灰色 = Abu-abu, 银色 = Silver.\n"
        . "- 各 = masing-masing (contoh: 红蓝线各200米 = Merah & Biru masing-masing 200 m).\n"
        . "- Kalau tidak yakin produk, grade, atau mereknya, tetap beri jawaban terbaik dan set confidence \"low\" dengan note singkat berbahasa Mandarin.\n"
        . 'Kembalikan JSON: {"items":[{"i":<index>,"name":"...","spec":"...","brand":"...","model":"...","confidence":"high|low","note":"中文说明，可空"}]} (brand / model string kosong jika input tidak ada)';
}

/** AI 翻译一批明细；返回 [index => [name, spec, brand, model, confidence, note]] */
function _transByAi(PDO $pdo, array $rows, string $lang, array $glossary): array
{
    $cfg = _aiOpenaiCfg($pdo);
    if (!$cfg) jsonError('还没配置 AI（系统设置 → AI），只能用术语表或手动填写译名');
    // 只把和这批物品相关的术语给 AI，避免提示词过长
    $related = [];
    foreach ($rows as $r) {
        $text = $r['product_name'] . ' ' . $r['spec'] . ' ' . $r['brand_display'] . ' ' . $r['model_display'];
        foreach ($glossary as $zh => $t) {
            if (mb_strpos($text, $zh) !== false) $related[$zh] = $t;
        }
    }
    $glossText = $related ? implode("\n", array_map(fn ($zh, $t) => "{$zh} = {$t}", array_keys($related), $related)) : '(无)';
    $list = [];
    foreach ($rows as $i => $r) {
        $showBrand = !empty($r['show_brand']);
        $list[] = [
            'i' => $i, 'name' => $r['product_name'], 'spec' => $r['spec'], 'unit' => $r['unit'],
            'brand' => $showBrand ? (string) $r['brand_display'] : '', 'model' => $showBrand ? (string) $r['model_display'] : '',
        ];
    }
    $out = [];
    // 分批：一次太多容易截断
    foreach (array_chunk($list, 40, true) as $chunk) {
        $resp = _aiCallOpenAI($cfg, [
            ['role' => 'system', 'content' => _transSystemPrompt($lang)],
            ['role' => 'user', 'content' => "GLOSSARY / GLOSARIUM:\n{$glossText}\n\nITEMS:\n" . json_encode(array_values($chunk), JSON_UNESCAPED_UNICODE)],
        ], ['max_tokens' => 8000]);
        $parsed = _aiDecodeJson($resp);
        foreach ((array) ($parsed['items'] ?? []) as $it) {
            if (!isset($it['i'])) continue;
            $out[(int) $it['i']] = [
                'name' => trim((string) ($it['name'] ?? '')),
                'spec' => trim((string) ($it['spec'] ?? '')),
                'brand' => trim((string) ($it['brand'] ?? '')),
                'model' => trim((string) ($it['model'] ?? '')),
                'confidence' => ($it['confidence'] ?? 'high') === 'low' ? 'low' : 'high',
                'note' => trim((string) ($it['note'] ?? '')),
            ];
        }
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

/** 物品名里出现的术语，译文没用术语表叫法的列出来（长词优先，短词被长词覆盖时不重复报） */
function _transGlossaryMisses(string $zh, string $translated, array $glossary): array
{
    $out = [];
    $covered = '';
    foreach ($glossary as $term => $t) {
        if (mb_strlen($term) < 2 || mb_strpos($zh, $term) === false || mb_strpos($covered, $term) !== false) continue;
        $covered .= '|' . $term;
        // 主叫法或括号里的别称，用了任意一个都算对（如 Mesin Airless Spray / Mesin Semprot Cat）
        $core = trim(preg_replace('/\s*\(.*?\)\s*/u', ' ', $t));
        preg_match_all('/\(([^)]+)\)/u', $t, $alts);
        $cands = array_filter(array_merge([$core], array_map('trim', $alts[1])));
        $hit = false;
        foreach ($cands as $cand) if (mb_stripos($translated, $cand) !== false) { $hit = true; break; }
        if ($cands && !$hit) $out[] = "术语表「{$term} = {$t}」";
    }
    return $out;
}

/** 已有译名这一行还有什么不合格（和前端对照表 / 打印页的判断一致）；空串 = 合格 */
function _transRowProblem(array $r, array $c): string
{
    $name = trim((string) $r[$c['name']]);
    $spec = trim((string) $r[$c['spec']]);
    $brand = trim((string) $r[$c['brand']]);
    $model = trim((string) $r[$c['model']]);
    if ($name === '') return '物品名没翻';
    if (trim((string) $r['spec']) !== '' && $spec === '') return '规格没翻';
    if (!empty($r['show_brand'])) {
        if (trim((string) $r['brand_display']) !== '' && $brand === '') return '品牌没翻';
        if (trim((string) $r['model_display']) !== '' && $model === '') return '型号没翻';
    }
    if (preg_match('/\p{Han}/u', $name . $spec . $brand . $model)) return '还有中文';
    return '';
}

function _transItemRows(PDO $pdo, int $qid): array
{
    $st = $pdo->prepare("SELECT id, product_name, spec, unit, show_brand, brand_display, model_display,
            name_id, spec_id, brand_id, model_id, trans_id_status,
            name_en, spec_en, brand_en, model_en, trans_en_status
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
    $c = _transCols($lang);
    $rows = _transItemRows($pdo, $qid);
    if (!$rows) jsonError('报价单没有明细');
    $force = !empty($input['force']);
    $glossary = _glossaryMap($pdo, $c['gloss']);

    $todo = [];
    $up = $pdo->prepare("UPDATE customer_quote_items SET {$c['name']} = ?, {$c['spec']} = ?, {$c['brand']} = ?, {$c['model']} = ?, {$c['status']} = ? WHERE id = ?");
    $notes = [];
    foreach ($rows as $r) {
        $status = (string) $r[$c['status']];
        // 已有译名但还不合格（留着中文 / 规格品牌型号没翻）：不管确认过没有都要重翻。
        // 早期确认的行只翻了物品名，规格还是中文（20261113 规则收紧前确认的）
        $bad = _transRowProblem($r, $c) !== '';
        if ($status === 'confirmed' && !$bad) continue;
        if (!$force && !$bad && $status !== '' && trim((string) $r[$c['name']]) !== '') continue;
        $zh = trim((string) $r['product_name']);
        $spec = trim((string) $r['spec']);
        $showBrand = !empty($r['show_brand']);
        $brand = $showBrand ? trim((string) $r['brand_display']) : '';
        $model = $showBrand ? trim((string) $r['model_display']) : '';
        // 物品名整条命中术语表，规格 / 品牌 / 型号也都是纯数字尺寸代码 → 直接用，不用 AI
        if (isset($glossary[$zh]) && !_transNeeds($spec) && !_transNeeds($brand) && !_transNeeds($model)) {
            $up->execute([$glossary[$zh], $spec, $brand, $model, 'glossary', (int) $r['id']]);
            continue;
        }
        $todo[] = $r;
    }
    if ($todo) {
        $ai = _transByAi($pdo, $todo, $lang, $glossary);
        foreach ($todo as $i => $r) {
            $t = $ai[$i] ?? null;
            if (!$t || $t['name'] === '') continue;
            $zh = trim((string) $r['product_name']);
            // 物品名整条在术语表里：以术语表为准，AI 只负责规格 / 品牌 / 型号
            if (isset($glossary[$zh])) $t['name'] = $glossary[$zh];
            // 之前人工确认过、且本身没问题的物品名不动（只补规格 / 品牌 / 型号）
            $oldName = trim((string) $r[$c['name']]);
            if ($r[$c['status']] === 'confirmed' && $oldName !== '' && !preg_match('/\p{Han}/u', $oldName)) $t['name'] = $oldName;
            $showBrand = !empty($r['show_brand']);
            if (!$showBrand) { $t['brand'] = ''; $t['model'] = ''; }
            $up->execute([$t['name'], $t['spec'], $t['brand'], $t['model'], 'ai', (int) $r['id']]);
            $warn = [];
            if ($t['confidence'] === 'low') $warn[] = '【AI 不确定】' . $t['note'];
            elseif ($t['note'] !== '') $warn[] = $t['note'];
            $src = $r['product_name'] . ' ' . $r['spec'] . ($showBrand ? ' ' . $r['model_display'] : '');
            $dst = $t['name'] . ' ' . $t['spec'] . ' ' . $t['model'];
            $miss = _transMissingNumbers($src, $dst);
            if ($miss) $warn[] = '【数字对不上】原文里的 ' . implode('、', $miss) . ' 没出现在译文里，请核对';
            if (preg_match('/\p{Han}/u', $dst . $t['brand'])) $warn[] = '【还有中文】译文里还留着中文没翻';
            if (trim((string) $r['spec']) !== '' && $t['spec'] === '') $warn[] = '【规格没翻】原文有规格，译文规格是空的';
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

/**
 * 人工确认译名；learn=1 时把「中文物品名 → 译名」存进术语表。
 * 强制：译文里不能有一个中文字；原来有规格 / 品牌 / 型号（且显示品牌）的，对应译文不能为空
 */
function handle_saveQuoteItemTranslations(PDO $pdo, array $input, array $user): void
{
    $qid = (int) ($input['quote_id'] ?? 0);
    $lang = ($input['lang'] ?? '') === 'en' ? 'en' : 'id';
    $c = _transCols($lang);
    $langName = $lang === 'en' ? '英文' : '印尼文';
    $items = (array) ($input['items'] ?? []);
    $learn = !empty($input['learn']);

    $src = [];
    foreach (_transItemRows($pdo, $qid) as $r) $src[(int) $r['id']] = $r;

    // 先全部校验，任何一行不合格就整批不存
    foreach ($items as $it) {
        $r = $src[(int) ($it['id'] ?? 0)] ?? null;
        if (!$r) continue;
        $label = "「{$r['product_name']}」";
        $name = trim((string) ($it['name'] ?? ''));
        $spec = trim((string) ($it['spec'] ?? ''));
        $brand = trim((string) ($it['brand'] ?? ''));
        $model = trim((string) ($it['model'] ?? ''));
        if ($name === '') jsonError("{$label}还没有{$langName}物品名");
        if (trim((string) $r['spec']) !== '' && $spec === '') jsonError("{$label}的规格还没翻成{$langName}");
        if (!empty($r['show_brand'])) {
            if (trim((string) $r['brand_display']) !== '' && $brand === '') jsonError("{$label}的品牌还没填{$langName}写法");
            if (trim((string) $r['model_display']) !== '' && $model === '') jsonError("{$label}的型号还没填{$langName}写法");
        }
        if (preg_match('/\p{Han}/u', $name . $spec . $brand . $model)) {
            jsonError("{$label}的译文里还有中文，必须全部是{$langName}");
        }
    }

    $up = $pdo->prepare("UPDATE customer_quote_items SET {$c['name']} = ?, {$c['spec']} = ?, {$c['brand']} = ?, {$c['model']} = ?, {$c['status']} = 'confirmed' WHERE id = ? AND quote_id = ?");
    // 不用 ON CONFLICT（服务器 SQLite 版本老），先查再改 / 插
    $glossFind = $pdo->prepare("SELECT id FROM term_glossary WHERE zh = ?");
    $glossUpd = $pdo->prepare("UPDATE term_glossary SET {$c['gloss']} = ?, updated_by = ?, updated_at = datetime('now','localtime') WHERE id = ?");
    $glossIns = $pdo->prepare("INSERT INTO term_glossary (zh, {$c['gloss']}, source, updated_by) VALUES (?, ?, 'confirmed', ?)");
    $n = 0;
    $learned = 0;
    foreach ($items as $it) {
        $id = (int) ($it['id'] ?? 0);
        if (!isset($src[$id])) continue;
        $name = trim((string) $it['name']);
        $up->execute([$name, trim((string) ($it['spec'] ?? '')), trim((string) ($it['brand'] ?? '')), trim((string) ($it['model'] ?? '')), $id, $qid]);
        $n++;
        if ($learn) {
            $zh = trim((string) $src[$id]['product_name']);
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
    if (preg_match('/\p{Han}/u', $idText . $enText)) jsonError('印尼语 / 英文里不能有中文');
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
