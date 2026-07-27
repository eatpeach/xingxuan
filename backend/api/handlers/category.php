<?php

/**
 * 品类管理（MRO 式三级：大类/中类/小类）
 * - 商品/供应商按品类「名称」关联（products.category 存叶子名），全树名称唯一
 * - 重命名时同步改写 products / suppliers / 加价率配置
 */

/** 递归构建品类树（任意层级，附 children） */
function _categoryTree(PDO $pdo, bool $onlyActive): array
{
    $where = $onlyActive ? 'WHERE is_active = 1' : '';
    $rows = $pdo->query("SELECT * FROM categories {$where} ORDER BY sort_weight DESC, id ASC")->fetchAll();
    $byParent = [];
    foreach ($rows as $r) {
        $pid = $r['parent_id'] === null ? 0 : (int) $r['parent_id'];
        $byParent[$pid][] = $r;
    }
    $build = function ($pid) use (&$build, $byParent) {
        $out = [];
        foreach ($byParent[$pid] ?? [] as $node) {
            $node['children'] = $build((int) $node['id']);
            $out[] = $node;
        }
        return $out;
    };
    return $build(0);
}

/** 品类名 → 自身 + 全部后代名称数组（货架按任意级过滤：商品可能挂在中类或小类） */
function categoryLeafNames(PDO $pdo, string $name): array
{
    $st = $pdo->prepare("SELECT id FROM categories WHERE name = ?");
    $st->execute([$name]);
    $id = (int) ($st->fetchColumn() ?: 0);
    if (!$id) return [$name];
    $names = [$name];
    $collect = function ($pid) use (&$collect, $pdo, &$names) {
        $st = $pdo->prepare("SELECT id, name FROM categories WHERE parent_id = ?");
        $st->execute([$pid]);
        foreach ($st->fetchAll() as $c) {
            $names[] = (string) $c['name'];
            $collect((int) $c['id']);
        }
    };
    $collect($id);
    return array_values(array_unique($names));
}

/** 某分类的层级（1=大类，2=中类，3=小类）；0=不存在 */
function _categoryLevel(PDO $pdo, int $id): int
{
    $lvl = 0;
    while ($id) {
        $st = $pdo->prepare("SELECT parent_id FROM categories WHERE id = ?");
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) return 0;
        $lvl++;
        $id = $row['parent_id'] !== null ? (int) $row['parent_id'] : 0;
        if ($lvl > 9) break;
    }
    return $lvl;
}

/** 子树深度（1=叶子，2=有子类，3=有孙类） */
function _subtreeDepth(PDO $pdo, int $id): int
{
    $st = $pdo->prepare("SELECT id FROM categories WHERE parent_id = ?");
    $st->execute([$id]);
    $kids = $st->fetchAll(PDO::FETCH_COLUMN);
    if (!$kids) return 1;
    $max = 1;
    foreach ($kids as $k) {
        $d = 1 + _subtreeDepth($pdo, (int) $k);
        if ($d > $max) $max = $d;
    }
    return $max;
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
    // 递归填充商品数/供应商数（父节点商品数含全部后代）
    $fill = function (array &$nodes) use (&$fill, $pCounts, $sCounts) {
        $total = 0;
        foreach ($nodes as &$n) {
            $self = $pCounts[$n['name']] ?? 0;
            $n['supplier_count'] = $sCounts[$n['name']] ?? 0;
            $sub = $fill($n['children']);
            $n['product_count'] = $self + $sub;
            $total += $n['product_count'];
        }
        unset($n);
        return $total;
    };
    $fill($tree);
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

    $parentLevel = 0;
    if ($parentId !== null) {
        $parentLevel = _categoryLevel($pdo, $parentId);
        if ($parentLevel === 0) jsonError('上级品类不存在');
        if ($parentLevel >= 3) jsonError('最多三级：不能挂在小类下面');
    }

    if ($id > 0) {
        $st = $pdo->prepare("SELECT * FROM categories WHERE id = ?");
        $st->execute([$id]);
        $old = $st->fetch();
        if (!$old) jsonError('品类不存在', 404);
        if ($parentId === $id) jsonError('不能把自己设为上级');
        if ($parentId !== null) {
            // 移动后总层级不能超过三级：上级层级 + 本节点子树深度 <= 3
            $depth = _subtreeDepth($pdo, $id);
            if ($parentLevel + $depth > 3) jsonError('该品类下还有子类，移动后会超过三级');
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
