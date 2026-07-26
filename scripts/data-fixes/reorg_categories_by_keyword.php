<?php
/**
 * 数据整理：把杂乱的品类按名称关键词自动归到 4 个大类下（保留所有细分品类）
 *
 * 背景：后台建了大量具体品类（红胚瓷砖/内外墙乳胶漆/轻钢龙骨/安全帽/电缆桥架/活动板房…），
 *       它们大多是顶级，和真正的大类平铺在一起，菜单又长又乱。
 * 做法：
 *   1. 确保 4 个大类存在：装修主材 / 建筑基材 / 五金机电 / 安全防护
 *   2. 把所有非大类的品类「摊平」（parent_id=NULL），删除无商品的旧大类空壳
 *   3. 逐个品类按名称关键词归到对应大类（成为子类）；匹配不上的留在顶级并列出
 *   4. 商品/供应商按品类「名称」关联，名称不变 => 数据零影响
 * 执行（服务器项目根目录）：
 *   php scripts/data-fixes/reorg_categories_by_keyword.php          # dry-run 预览归类结果
 *   php scripts/data-fixes/reorg_categories_by_keyword.php --apply  # 真正执行
 * 幂等：重复执行结果一致；已归好的保持。若归类不满意，可在后台品类管理里手动调整个别项。
 */

require __DIR__ . '/../../backend/config/database.php';

$apply = in_array('--apply', $argv ?? [], true);
$pdo = Database::getInstance()->getConnection();

// 4 个大类
$tops = ['装修主材', '建筑基材', '五金机电', '安全防护'];

// 关键词规则（按顺序匹配，第一个命中的大类胜；装修主材关键词最泛，放最后兜底）
$rules = [
    '安全防护' => ['安全帽', '安全鞋', '防护', '反光', '劳保', '手套', '口罩', '护目', '绝缘鞋', '警示'],
    '五金机电' => ['五金', '工具', '水暖', '阀', '锁具', '紧固', '螺栓', '螺丝', '膨胀', '电线', '电缆', '电源线', '配电', '桥架', '开关', '插座', '线管', '水管', '管件', '水泵', '合页', '拉手'],
    '建筑基材' => ['水泥', '混凝土', '砼', '钢材', '钢筋', '型钢', '钢管', '砂', '石子', '骨料', '防水', '保温', '板房', '砌块', '红砖', '加气', '脚手', '模板'],
    '装修主材' => ['瓷砖', '砖', '涂料', '漆', '乳胶', '墙纸', '壁布', '地板', '石材', '大理石', '龙骨', '石膏', '铝扣板', '铝方通', '蜂窝', '吊顶', '天花', '墙板', '板材', '木', '卫浴', '马桶', '龙头', '花洒', '浴室', '台盆', '洁具', '淋浴', '灯', '照明', '门', '窗', '幕墙', '卷帘', '面板', '线条', '踢脚'],
];

$getId = function (string $name) use ($pdo) {
    $st = $pdo->prepare("SELECT id FROM categories WHERE name = ?");
    $st->execute([$name]);
    return (int) ($st->fetchColumn() ?: 0);
};
$prodCount = function (string $name) use ($pdo) {
    $st = $pdo->prepare("SELECT COUNT(*) FROM products WHERE category = ?");
    $st->execute([$name]);
    return (int) $st->fetchColumn();
};

$log = [];

// 1. 确保 4 大类存在
$w = 100;
foreach ($tops as $t) {
    if (!$getId($t)) {
        $log[] = "建大类：{$t}";
        if ($apply) {
            $pdo->prepare("INSERT INTO categories (parent_id, name, sort_weight, is_active) VALUES (NULL, ?, ?, 1)")
                ->execute([$t, $w]);
        }
    }
    $w--;
}

// 2. 摊平所有非大类的品类（parent_id=NULL），删除无商品的旧大类空壳
$topIds = [];
foreach ($tops as $t) {
    $id = $getId($t);
    if ($id) $topIds[] = $id;
}
$topIdList = $topIds ? implode(',', $topIds) : '0';

// 旧的大类空壳（名字像大类、且无商品）：本身不是新 4 大类、名下曾有子类、自己无商品 => 删除
$oldShellNames = ['装饰主材', '卫浴洁具', '照明电工', '门窗系统', '五金水暖'];
foreach ($oldShellNames as $sh) {
    $id = $getId($sh);
    if ($id && $prodCount($sh) === 0) {
        $log[] = "删除旧大类空壳：{$sh}（其子类将重新归类）";
        if ($apply) {
            $pdo->exec("UPDATE categories SET parent_id = NULL WHERE parent_id = {$id}");
            $pdo->exec("DELETE FROM categories WHERE id = {$id}");
        }
    }
}

if ($apply) {
    // 其余全部摊平（新大类本身除外）
    $pdo->exec("UPDATE categories SET parent_id = NULL WHERE id NOT IN ({$topIdList})");
}

// 3. 逐个归类
$leaves = $pdo->query("SELECT id, name, parent_id FROM categories
    WHERE name NOT IN ('" . implode("','", $tops) . "') ORDER BY id ASC")->fetchAll();

$unmatched = [];
$assign = [];
foreach ($leaves as $c) {
    $name = (string) $c['name'];
    $hit = null;
    foreach ($rules as $top => $kws) {
        foreach ($kws as $kw) {
            if (mb_strpos($name, $kw) !== false) {
                $hit = $top;
                break 2;
            }
        }
    }
    if ($hit === null) {
        $unmatched[] = $name;
        continue;
    }
    $assign[$hit][] = $name;
    if ($apply) {
        $pdo->prepare("UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name = ?) WHERE id = ?")
            ->execute([$hit, (int) $c['id']]);
    }
}

// 4. 输出
echo ($apply ? "== 已执行归类 ==\n" : "== DRY-RUN（加 --apply 才真正执行）==\n");
foreach ($log as $l) echo " - {$l}\n";
echo "\n归类结果：\n";
foreach ($tops as $t) {
    $kids = $assign[$t] ?? [];
    echo "· {$t}（" . count($kids) . " 项）\n";
    foreach ($kids as $k) echo "    - {$k}\n";
}
if ($unmatched) {
    echo "\n⚠ 未匹配（保留在顶级，请在后台手动归类或改名后重跑）：\n";
    foreach ($unmatched as $u) echo "    - {$u}\n";
}
echo "\n（商品按品类名称关联，名称不变，数据不受影响）\n";
