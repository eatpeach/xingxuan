<?php
/**
 * 数据修复：把历史发票「活的」抬头 / 银行信息冻结成快照（20260809-07 第 2 步）
 *
 * 背景：21 张已开发票的 invoice_entity_* / invoice_bank_* 全为空，
 * InvoicePrint.tsx:80 的回落链 `data.invoice_entity_name || settings.company_name`
 * 让它们印出来的内容取自【当前】system_settings——这不是快照，是活的。
 * 改一次公司抬头或银行账号，历史发票重打就全变样，客户手上那份对不上。
 *
 * 为什么可以直接用当前值回填（CTO 2026-08-09 14:16 裁决，两条独立证据链）：
 *   1. op_logs：8 个回落设置项里 7 项无变更记录，唯一变过的 pdf_logo_path 两次都在
 *      2026-05-08，比最早开票（2026-05-12 11:32:40）早 4 天
 *   2. system_settings.updated_at：bank_* 停在 2026-05-12 11:32:15，比最早开票早 25 秒
 *   → 开票当时的回落值 = 现在的值，回填是精确的，不是冻结猜测值
 *
 * 口径（CTO 定，别自行放宽）：
 *   - invoice_entity_id 保持 NULL：这些发票开票时根本没选过主体，硬挂到 payment_entity
 *     等于伪造当时不存在的事实
 *   - invoice_entity_tax_no（NPWP）不填：该列为空时 InvoicePrint.tsx:203 印的是【公司标语】
 *     不是空白，填了会改变渲染结果
 *   - 已有非空值的列一律不覆盖（SQL 层用 CASE WHEN 兜底，见下）
 *   - 源值为空的列写了也不生效（JS 里 '' 是 falsy，照样回落到 settings），跳过并标注
 *
 * 安全措施：--apply 前自动 VACUUM INTO 备份（WAL 安全的一致性快照），路径会打印出来。
 * 幂等：只填空列，重复执行无副作用（SQL 层 CASE WHEN 保证，即便期间有人开了新发票也不会覆盖）。
 *
 * 执行（服务器项目根目录 /www/wwwroot/www.xingxuan.cc）：
 *   php scripts/data-fixes/backfill_invoice_snapshots.php            # dry-run 预览
 *   php scripts/data-fixes/backfill_invoice_snapshots.php --apply    # 真正回填（自动先备份）
 */

require __DIR__ . '/../../backend/config/database.php';

$argvSafe = $argv ?? [];
$apply    = in_array('--apply', $argvSafe, true);

$pdo = Database::getInstance()->getConnection();
$pdo->exec('PRAGMA foreign_keys = ON');

echo $apply ? "== 执行模式（会真写库）==\n" : "== dry-run 预览（加 --apply 才真正写库）==\n";
echo "时间：" . date('Y-m-d H:i:s') . "\n";

/**
 * 回填映射：快照列 ← system_settings 的哪一项。
 * fallback 是 InvoicePrint.tsx 回落链末端的【硬编码值】——设置项为空时页面印的是它，
 * 写进快照才能保证「渲染前后一致」。列名全部来自本常量，不来自输入，无注入面。
 */
$SPEC = [
    ['col' => 'invoice_entity_name',       'key' => 'company_name',      'fallback' => '星选建材'],
    ['col' => 'invoice_entity_logo_path',  'key' => 'pdf_logo_path',     'fallback' => 'brand/logo.png'],
    ['col' => 'invoice_bank_name',         'key' => 'bank_name',         'fallback' => ''],
    ['col' => 'invoice_bank_account_no',   'key' => 'bank_account_no',   'fallback' => ''],
    ['col' => 'invoice_bank_account_name', 'key' => 'bank_account_name', 'fallback' => ''],
    ['col' => 'invoice_entity_address',    'key' => 'company_address',   'fallback' => ''],
    ['col' => 'invoice_entity_phone',      'key' => 'company_phone',     'fallback' => ''],
    ['col' => 'invoice_bank_swift',        'key' => 'bank_swift',        'fallback' => ''],
];

// ---------- 0. 前置检查：列在不在（老库可能没跑到 migrate）----------
$cols    = array_column($pdo->query("PRAGMA table_info(customer_quotes)")->fetchAll(), 'name');
$need    = array_merge(['invoice_no', 'invoice_entity_id'], array_column($SPEC, 'col'));
$missing = array_values(array_diff($need, $cols));
if ($missing) {
    fwrite(STDERR, "\n这个库还缺列：" . implode(', ', $missing)
        . "\n说明 migrate 没跑过（先访问一次任意 API 触发 initialize），回填终止。\n");
    exit(1);
}

// ---------- 1. 取当前设置值，定出每一列到底写什么 ----------
echo "\n=== 1. 要冻结的值（取自 system_settings 当前值）===\n";

$stSetting = $pdo->prepare("SELECT value FROM system_settings WHERE key = ?");
$values    = [];   // col => 要写入的值（'' 表示写了也不生效，跳过）
$frozen    = [];   // 能真正冻住的列
$deadCols  = [];   // 源值为空、写了也不生效的列

foreach ($SPEC as $s) {
    $stSetting->execute([$s['key']]);
    $raw = $stSetting->fetchColumn();
    // 判空必须精确镜像 JS 的 falsy 语义：只有 '' 才回落。
    // 不能用 trim()——'   ' 在 JS 里是 truthy，页面会照印，当成空就改变了渲染结果。
    $raw = ($raw === false || $raw === null) ? '' : (string) $raw;

    $val = $raw !== '' ? $raw : $s['fallback'];
    $values[$s['col']] = $val;

    if ($val === '') {
        $deadCols[] = $s['col'];
        printf("  %-28s ← %-18s （空）  ❌ 冻不住\n", $s['col'], $s['key']);
    } else {
        $frozen[] = $s['col'];
        $note = $raw === '' ? '  ⚠ 设置项为空，用的是页面硬编码回落值' : '';
        printf("  %-28s ← %-18s %s%s\n", $s['col'], $s['key'], $val, $note);
    }
}

if ($deadCols) {
    echo "\n  ❌ 上面标「冻不住」的列，源值本身是空的。InvoicePrint.tsx 用 `||` 回落，\n";
    echo "     JS 里空字符串是 falsy —— 把 '' 写进快照，渲染时照样回落到 settings，写了等于没写。\n";
    echo "     CTO 裁决（07 号单第三条）：接受这个残留，不改渲染逻辑，本脚本【跳过这些列】。\n";
    echo "     影响：将来在设置里填上 " . implode(' / ', $deadCols) . " 对应的项，历史发票会开始显示它们。\n";
}

echo "\n  以下列【故意不动】：\n";
echo "    invoice_entity_tax_no    —— 空时印的是公司标语不是空白，填了会改变渲染（CTO 裁决第二条）\n";
echo "    invoice_entity_id        —— 保持 NULL，这些发票开票时没选过主体，硬挂等于伪造事实\n";
echo "    invoice_account_id       —— 同上\n";
echo "    invoice_bank_branch      —— system_settings 里没有对应项，无源可取\n";

if (!$frozen) {
    echo "\n没有任何一列有值可冻，无事可做。\n";
    exit(0);
}

// ---------- 2. 算出每张发票要补哪几列 ----------
/**
 * 只补空列。$values 里已排除源值为空的列，所以这里不会写入 ''。
 */
$planFor = static function (array $row) use ($values, $frozen): array {
    $fills = [];
    foreach ($frozen as $col) {
        if ((string) ($row[$col] ?? '') === '') {
            $fills[$col] = $values[$col];
        }
    }
    return $fills;
};

$selectSql = "SELECT q.id, q.no, q.invoice_no, q.invoice_issued_at, q.invoice_entity_id,
                     c.name AS customer_name, "
    . implode(', ', array_map(fn($c) => "q.{$c}", array_column($SPEC, 'col'))) . "
                FROM customer_quotes q
                LEFT JOIN customers c ON c.id = q.customer_id
               WHERE IFNULL(q.invoice_no,'') <> ''
               ORDER BY q.invoice_issued_at";

$rows = $pdo->query($selectSql)->fetchAll();

echo "\n=== 2. 逐张发票：要补哪几列 ===\n";
printf("已开发票 %d 张\n\n", count($rows));

if (!$rows) {
    echo "这个库里一张已开发票都没有，无事可做（是不是连错库了？）。\n";
    exit(0);
}

$todo     = [];
$colCount = array_fill_keys($frozen, 0);
$intact   = 0;

foreach ($rows as $r) {
    $fills = $planFor($r);
    if (!$fills) {
        $intact++;
        continue;
    }
    $todo[] = ['row' => $r, 'fills' => $fills];
    foreach (array_keys($fills) as $c) {
        $colCount[$c]++;
    }
}

if (!$todo) {
    echo "所有已开发票的快照列都已有值，无需回填（幂等：脚本可能已经跑过）。\n";
    exit(0);
}

printf("%-14s %-16s %-12s %-14s %s\n", '报价号', '发票号', '开票日', '客户', '要补的列');
foreach ($todo as $t) {
    $r = $t['row'];
    printf(
        "%-14s %-16s %-12s %-14s %s\n",
        $r['no'],
        $r['invoice_no'],
        substr((string) $r['invoice_issued_at'], 0, 10),
        mb_substr((string) $r['customer_name'], 0, 12),
        implode(', ', array_map(fn($c) => str_replace('invoice_', '', $c), array_keys($t['fills'])))
    );
}

echo "\n--- 汇总 ---\n";
printf("要回填的发票：%d 张  ｜  快照列已有值、本次不动：%d 张\n", count($todo), $intact);
echo "按列统计（各有多少张是空的、要补）：\n";
foreach ($colCount as $c => $n) {
    printf("  %-28s %d 张\n", $c, $n);
}

// ---------- 3. dry-run 到此为止 ----------
if (!$apply) {
    echo "\n以上为预览，未写任何数据。确认无误后执行：\n";
    echo "  php scripts/data-fixes/backfill_invoice_snapshots.php --apply\n";
    exit(0);
}

// ---------- 4. 备份 ----------
$dbFile  = __DIR__ . '/../../backend/data/xingxuan.db';
$bakFile = $dbFile . '.bak-' . date('Ymd-His');
echo "\n[1/3] 备份数据库 → {$bakFile}\n";
try {
    // VACUUM INTO 出的是一致性快照，WAL 未 checkpoint 的内容也包含在内
    $pdo->exec("VACUUM INTO " . $pdo->quote($bakFile));
} catch (Throwable $e) {
    echo "  VACUUM INTO 失败（{$e->getMessage()}），回退到文件拷贝\n";
    foreach (['', '-wal', '-shm'] as $suffix) {
        if (is_file($dbFile . $suffix)) {
            copy($dbFile . $suffix, $bakFile . $suffix);
        }
    }
}
if (!is_file($bakFile)) {
    echo "  ✗ 备份失败，中止。请检查 backend/data 目录写权限。\n";
    exit(1);
}
printf("  ✓ 备份完成（%.1f MB）\n", filesize($bakFile) / 1048576);
echo "    回滚办法：停 nginx → cp '{$bakFile}' '{$dbFile}' → 删同名 -wal/-shm → 启 nginx\n";

// ---------- 5. 事务内回填 ----------
echo "\n[2/3] 回填快照列\n";

$pdo->beginTransaction();
try {
    // 事务内重新读一次，以事务内的实际状态为准（避免与上面 SELECT 之间有人开了新发票）
    $fresh   = $pdo->query($selectSql)->fetchAll();
    $written = 0;
    $cells   = 0;

    $stLog = $pdo->prepare(
        "INSERT INTO op_logs (user_id, actor_label, entity, entity_id, action, detail)
         VALUES (NULL, 'script:backfill_invoice_snapshots', 'customer_quote', ?, 'backfill_invoice_snapshot', ?)"
    );

    foreach ($fresh as $r) {
        $fills = $planFor($r);
        if (!$fills) {
            continue;
        }

        // SET 子句与参数在同一个循环里生成，从结构上保证「占位符数 = 参数数」
        $sets   = [];
        $params = [];
        foreach ($fills as $col => $val) {
            // CASE WHEN 是第二道保险：即便这一瞬间该列被别的请求写了值，也绝不覆盖
            $sets[]   = "{$col} = CASE WHEN IFNULL({$col},'') = '' THEN ? ELSE {$col} END";
            $params[] = $val;
        }
        $sql      = "UPDATE customer_quotes SET " . implode(', ', $sets) . " WHERE id = ?";
        $params[] = (int) $r['id'];

        // 本项目最常翻车的点，执行前显式自查一次
        if (substr_count($sql, '?') !== count($params)) {
            throw new RuntimeException(
                "占位符数(" . substr_count($sql, '?') . ") != 参数数(" . count($params) . ")，报价 #{$r['id']}"
            );
        }

        $pdo->prepare($sql)->execute($params);

        $stLog->execute([
            (int) $r['id'],
            '20260809-07 回填发票主体/银行快照：' . implode(',', array_keys($fills))
                . '（值取自 system_settings 当时=当前值，invoice_entity_id 保持 NULL）',
        ]);

        $written++;
        $cells += count($fills);
        printf(
            "  ✓ %-14s %-16s 补 %d 列：%s\n",
            $r['no'],
            $r['invoice_no'],
            count($fills),
            implode(', ', array_map(fn($c) => str_replace('invoice_', '', $c), array_keys($fills)))
        );
    }

    $pdo->commit();
    printf("  ✓ 共回填 %d 张发票、%d 个单元格，已提交\n", $written, $cells);
} catch (Throwable $e) {
    $pdo->rollBack();
    echo "  ✗ 回填失败，整体已回滚：{$e->getMessage()}\n";
    echo "    数据库未改动，备份文件可删：{$bakFile}\n";
    exit(1);
}

// ---------- 6. 复核 ----------
echo "\n[3/3] 复核\n";

$issued = (int) $pdo->query("SELECT COUNT(*) FROM customer_quotes WHERE IFNULL(invoice_no,'') <> ''")->fetchColumn();
$stillEmpty = 0;
foreach ($pdo->query($selectSql)->fetchAll() as $r) {
    if ($planFor($r)) {
        $stillEmpty++;
    }
}
printf("  已开发票 %d 张，其中仍有空快照列的：%d 张\n", $issued, $stillEmpty);

$noBank = (int) $pdo->query("SELECT COUNT(*) FROM customer_quotes
     WHERE IFNULL(invoice_no,'') <> '' AND IFNULL(invoice_bank_account_no,'') = ''")->fetchColumn();
$noEntityId = (int) $pdo->query("SELECT COUNT(*) FROM customer_quotes
     WHERE IFNULL(invoice_no,'') <> '' AND invoice_entity_id IS NULL")->fetchColumn();
printf("  invoice_bank_account_no 仍为空：%d 张（回填前 15）\n", $noBank);
printf("  invoice_entity_id IS NULL     ：%d 张（【按设计不变】，CTO 定保持 NULL）\n", $noEntityId);

echo "\n  ⚠ 复跑 audit_invoice_entity_snapshot.php 时注意：\n";
echo "     它的「快照完整」判据是 invoice_entity_id IS NOT NULL AND bank_account_no <> ''，\n";
echo "     而本单裁决【保持 entity_id = NULL】，所以那个数字回填后仍是 0，不是没生效。\n";
echo "     真正该看的是「invoice_bank_account_no = ''」从 15 → 0。\n";

echo "\n完成。备份留在：{$bakFile}\n";
