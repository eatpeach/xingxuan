<?php

/**
 * 品类管理（MRO 式两级：大类/子类）
 * - 商品/供应商仍按品类「名称」关联（products.category 存叶子名），
 *   因此全树名称唯一；重命名时同步改写 products / suppliers / 加价率配置
 */

function _categoryTree(PDO $pdo, bool $onlyActive): array
{
    $where = $onlyActive ? 'WHERE is_active = 1' : '';
    $rows = $pdo->query("SELECT * FROM categories {$where} ORDER BY sort_weight DESC, id ASC")->fetchAll();
    $tops = [];
    $children = [];
    foreach ($rows as $r) {
        if ($r['parent_id'] === null) {
            $tops[] = $r;
        } else {
            $children[(int) $r['parent_id']][] = $r;
        }
    }
    $tree = [];
    foreach ($tops as $t) {
        $t['children'] = $children[(int) $t['id']] ?? [];
        $tree[] = $t;
    }
    return $tree;
}

/** 大类名 → 该大类 + 全部子类的名称数组（用于货架按大类过滤）；子类名 → 自身 */
function categoryLeafNames(PDO $pdo, string $name): array
{
    $st = $pdo->prepare("SELECT id, parent_id FROM categories WHERE name = ?");
    $st->execute([$name]);
    $cat = $st->fetch();
    if (!$cat || $cat['parent_id'] !== null) return [$name];
    $st = $pdo->prepare("SELECT name FROM categories WHERE parent_id = ?");
    $st->execute([(int) $cat['id']]);
    $names = $st->fetchAll(PDO::FETCH_COLUMN);
    array_unshift($names, $name);
    return array_values($names);
}

/** 品类树（含商品数/供应商数，管理端用，含停用） */
function handle_listCategories(PDO $pdo): void
{
    $pCounts = [];
    foreach ($pdo->query("SELECT category, COUNT(*) c FROM products GROUP BY category")->fetchAll() as $r) {
        $pCounts[(string) $r['category']] = (int) $r['c'];
    }
    $suppliers = $pdo->query("SELECT category FROM suppliers WHERE category != ''")->fetchAll(PDO::FETCH_COLUMN);
    $sCounts = [];
    foreach ($suppliers as $sc) {
        foreach (preg_split('/[,，、\/]/u', (string) $sc) as $part) {
            $part = trim($part);
            if ($part !== '') $sCounts[$part] = ($sCounts[$part] ?? 0) + 1;
        }
    }
    $tree = _categoryTree($pdo, false);
    foreach ($tree as &$t) {
        $t['product_count'] = $pCounts[$t['name']] ?? 0;
        $t['supplier_count'] = $sCounts[$t['name']] ?? 0;
        foreach ($t['children'] as &$c) {
            $c['product_count'] = $pCounts[$c['name']] ?? 0;
            $c['supplier_count'] = $sCounts[$c['name']] ?? 0;
            $t['product_count'] += $c['product_count'];
        }
        unset($c);
    }
    unset($t);
    jsonOk(['items' => $tree]);
}

function handle_saveCategory(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理品类', 403);
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') jsonError('请填写品类名称');
    $parentId = isset($input['parent_id']) && $input['parent_id'] !== null && $input['parent_id'] !== ''
        ? (int) $input['parent_id'] : null;
    $id = (int) ($input['id'] ?? 0);

    // 名称全树唯一（按名称关联商品，必须无歧义）
    $st = $pdo->prepare("SELECT COUNT(*) FROM categories WHERE name = ? AND id != ?");
    $st->execute([$name, $id]);
    if ((int) $st->fetchColumn() > 0) jsonError('品类名称已存在');

    if ($parentId !== null) {
        $st = $pdo->prepare("SELECT parent_id FROM categories WHERE id = ?");
        $st->execute([$parentId]);
        $p = $st->fetch();
        if (!$p) jsonError('上级品类不存在');
        if ($p['parent_id'] !== null) jsonError('仅支持两级：子类不能再挂子类');
    }

    if ($id > 0) {
        $st = $pdo->prepare("SELECT * FROM categories WHERE id = ?");
        $st->execute([$id]);
        $old = $st->fetch();
        if (!$old) jsonError('品类不存在', 404);
        if ($parentId === $id) jsonError('不能把自己设为上级');
        if ($parentId !== null) {
            $st = $pdo->prepare("SELECT COUNT(*) FROM categories WHERE parent_id = ?");
            $st->execute([$id]);
            if ((int) $st->fetchColumn() > 0) jsonError('该品类下有子类，不能改为子类');
        }
        $pdo->prepare("UPDATE categories SET name = ?, parent_id = ?, is_active = ? WHERE id = ?")
            ->execute([$name, $parentId, isset($input['is_active']) ? (int) !!$input['is_active'] : (int) $old['is_active'], $id]);

        // 重命名：同步商品 / 供应商 / 品类加价率配置
        $oldName = (string) $old['name'];
        if ($oldName !== $name) {
            $pdo->prepare("UPDATE products SET category = ? WHERE category = ?")->execute([$name, $oldName]);
            foreach ($pdo->query("SELECT id, category FROM suppliers WHERE category != ''")->fetchAll() as $s) {
                $parts = preg_split('/[,，、\/]/u', (string) $s['category']);
                $changed = false;
                foreach ($parts as &$part) {
                    if (trim($part) === $oldName) {
                        $part = $name;
                        $changed = true;
                    }
                }
                unset($part);
                if ($changed) {
                    $pdo->prepare("UPDATE suppliers SET category = ? WHERE id = ?")
                        ->execute([implode(',', array_map('trim', $parts)), (int) $s['id']]);
                }
            }
            $markup = getSetting($pdo, 'shelf.category_markup', '');
            if ($markup !== '') {
                $lines = preg_split('/\r?\n/', $markup);
                foreach ($lines as &$line) {
                    $kv = preg_split('/[:：]/u', $line, 2);
                    if (count($kv) === 2 && trim($kv[0]) === $oldName) {
                        $line = $name . ':' . trim($kv[1]);
                    }
                }
                unset($line);
                setSetting($pdo, 'shelf.category_markup', implode("\n", $lines));
            }
        }
        opLog($pdo, 'category', $id, 'update', "{$oldName} -> {$name}", (int) $user['id']);
        jsonOk(['id' => $id]);
    }

    $maxW = (int) $pdo->query("SELECT COALESCE(MAX(sort_weight), 0) FROM categories")->fetchColumn();
    $pdo->prepare("INSERT INTO categories (parent_id, name, sort_weight) VALUES (?, ?, ?)")
        ->execute([$parentId, $name, $maxW + 1]);
    $nid = (int) $pdo->lastInsertId();
    opLog($pdo, 'category', $nid, 'create', $name, (int) $user['id']);
    jsonOk(['id' => $nid]);
}

/** 同级内上移/下移 */
function handle_moveCategory(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理品类', 403);
    $id = (int) ($input['id'] ?? 0);
    $dir = (string) ($input['direction'] ?? 'up');
    $st = $pdo->prepare("SELECT * FROM categories WHERE id = ?");
    $st->execute([$id]);
    $cur = $st->fetch();
    if (!$cur) jsonError('品类不存在', 404);

    $cmp = $dir === 'up' ? '>' : '<';
    $ord = $dir === 'up' ? 'ASC' : 'DESC';
    $parentCond = $cur['parent_id'] === null ? 'parent_id IS NULL' : 'parent_id = ' . (int) $cur['parent_id'];
    // 排序键相等时按 id 排，交换 sort_weight 前先保证两者不同
    $st = $pdo->query("SELECT * FROM categories WHERE {$parentCond} AND (sort_weight {$cmp} {$cur['sort_weight']}
        OR (sort_weight = {$cur['sort_weight']} AND id " . ($dir === 'up' ? '<' : '>') . " {$cur['id']}))
        ORDER BY sort_weight {$ord}, id " . ($dir === 'up' ? 'DESC' : 'ASC') . " LIMIT 1");
    $other = $st->fetch();
    if (!$other) jsonOk(); // 已到顶/底

    $a = (int) $cur['sort_weight'];
    $b = (int) $other['sort_weight'];
    if ($a === $b) {
        $b = $dir === 'up' ? $a + 1 : $a - 1;
        $pdo->prepare("UPDATE categories SET sort_weight = ? WHERE id = ?")->execute([$b, (int) $cur['id']]);
    } else {
        $pdo->prepare("UPDATE categories SET sort_weight = ? WHERE id = ?")->execute([$b, (int) $cur['id']]);
        $pdo->prepare("UPDATE categories SET sort_weight = ? WHERE id = ?")->execute([$a, (int) $other['id']]);
    }
    jsonOk();
}

function handle_deleteCategory(PDO $pdo, array $input, array $user): void
{
    if ($user['role'] !== 'admin') jsonError('仅管理员可管理品类', 403);
    $id = (int) ($input['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM categories WHERE id = ?");
    $st->execute([$id]);
    $cat = $st->fetch();
    if (!$cat) jsonError('品类不存在', 404);

    $st = $pdo->prepare("SELECT COUNT(*) FROM categories WHERE parent_id = ?");
    $st->execute([$id]);
    if ((int) $st->fetchColumn() > 0) jsonError('请先删除或移走该大类下的子类');
    $st = $pdo->prepare("SELECT COUNT(*) FROM products WHERE category = ?");
    $st->execute([(string) $cat['name']]);
    $n = (int) $st->fetchColumn();
    if ($n > 0) jsonError("该品类下还有 {$n} 个商品，请先调整商品品类");

    $pdo->prepare("DELETE FROM categories WHERE id = ?")->execute([$id]);
    opLog($pdo, 'category', $id, 'delete', (string) $cat['name'], (int) $user['id']);
    jsonOk();
}
