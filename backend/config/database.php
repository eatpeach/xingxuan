<?php
/**
 * 星选建材 数据库配置
 * SQLite (WAL) + PDO，启动时自动建表 + 初始化默认数据
 */

@date_default_timezone_set('Asia/Shanghai');

class Database
{
    private static $instance = null;
    private $pdo;

    private function __construct()
    {
        $dbDir = __DIR__ . '/../data';
        if (!is_dir($dbDir)) {
            mkdir($dbDir, 0755, true);
        }
        $dbPath = $dbDir . '/xingxuan.db';
        $this->pdo = new PDO('sqlite:' . $dbPath);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA journal_mode=WAL');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
        $this->pdo->exec('PRAGMA foreign_keys=ON');
    }

    public static function getInstance(): Database
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection(): PDO
    {
        return $this->pdo;
    }

    public function initialize(): void
    {
        $pdo = $this->pdo;
        $pdo->exec("CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT '',
            role TEXT DEFAULT 'sales',
            phone TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT DEFAULT '',
            name TEXT NOT NULL,
            short_name TEXT DEFAULT '',
            company TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            wechat TEXT DEFAULT '',
            address TEXT DEFAULT '',
            source TEXT DEFAULT '',
            sales_id INTEGER,
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)");
        // idx_customers_code 索引在 migrate() 里建 —— 老库 customers 还没 code 列，这里建会炸

        $pdo->exec("CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            category TEXT DEFAULT '',
            rating INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS inquiries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no TEXT UNIQUE NOT NULL,
            customer_id INTEGER NOT NULL,
            title TEXT DEFAULT '',
            status TEXT DEFAULT 'draft',
            deadline TEXT,
            remark TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS inquiry_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inquiry_id INTEGER NOT NULL,
            line_no INTEGER DEFAULT 1,
            product_name TEXT NOT NULL,
            spec TEXT DEFAULT '',
            unit TEXT DEFAULT '件',
            qty REAL DEFAULT 1,
            target_price REAL,
            remark TEXT DEFAULT '',
            FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_inquiry_items_iid ON inquiry_items(inquiry_id)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS inquiry_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inquiry_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inquiry_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            token_expire_at TEXT,
            status TEXT DEFAULT 'pending',
            sent_at TEXT,
            responded_at TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(inquiry_id, supplier_id),
            FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no TEXT UNIQUE NOT NULL,
            dispatch_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            inquiry_id INTEGER NOT NULL,
            total REAL DEFAULT 0,
            valid_until TEXT,
            status TEXT DEFAULT 'draft',
            attachment_path TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (dispatch_id) REFERENCES dispatches(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sq_inquiry ON supplier_quotes(inquiry_id)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_quote_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL,
            inquiry_item_id INTEGER NOT NULL,
            brand TEXT DEFAULT '',
            model TEXT DEFAULT '',
            spec TEXT DEFAULT '',
            supplier_price REAL DEFAULT 0,
            qty REAL DEFAULT 1,
            unit TEXT DEFAULT '件',
            lead_time TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            FOREIGN KEY (quote_id) REFERENCES supplier_quotes(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sqi_quote ON supplier_quote_items(quote_id)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS customer_quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no TEXT UNIQUE NOT NULL,
            inquiry_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            status TEXT DEFAULT 'draft',
            markup_strategy TEXT,
            total REAL DEFAULT 0,
            valid_until TEXT,
            exported_pdf_path TEXT DEFAULT '',
            sent_at TEXT,
            remark TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS customer_quote_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL,
            inquiry_item_id INTEGER NOT NULL,
            source_supplier_quote_item_id INTEGER,
            show_brand INTEGER DEFAULT 0,
            brand_display TEXT DEFAULT '',
            model_display TEXT DEFAULT '',
            product_name TEXT DEFAULT '',
            spec TEXT DEFAULT '',
            unit TEXT DEFAULT '件',
            qty REAL DEFAULT 1,
            cost_price REAL DEFAULT 0,
            sell_price REAL DEFAULT 0,
            markup_amount REAL DEFAULT 0,
            remark TEXT DEFAULT '',
            FOREIGN KEY (quote_id) REFERENCES customer_quotes(id) ON DELETE CASCADE
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS markup_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            value REAL,
            payload TEXT,
            is_default INTEGER DEFAULT 0,
            remark TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT '',
            description TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS op_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            actor_label TEXT DEFAULT '',
            entity TEXT NOT NULL,
            entity_id INTEGER,
            action TEXT NOT NULL,
            detail TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $this->migrate();
        $this->seed();
    }

    /** 兼容旧库：给老表加上后续添加的列 + 补齐缺失的客户编号 */
    private function migrate(): void
    {
        $pdo = $this->pdo;

        // 1. customers 加 code / short_name 列（如果不存在）
        $cols = $pdo->query("PRAGMA table_info(customers)")->fetchAll();
        $colNames = array_column($cols, 'name');
        if (!in_array('code', $colNames, true)) {
            $pdo->exec("ALTER TABLE customers ADD COLUMN code TEXT DEFAULT ''");
        }
        if (!in_array('short_name', $colNames, true)) {
            $pdo->exec("ALTER TABLE customers ADD COLUMN short_name TEXT DEFAULT ''");
        }
        // 列就位后再建依赖该列的索引（无条件 IF NOT EXISTS，新老库都安全）
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(code) WHERE code != ''");

        // 2. 给所有还没编号的客户补一个（10001 起）
        $rows = $pdo->query("SELECT id FROM customers WHERE code IS NULL OR code = '' ORDER BY id ASC")->fetchAll();
        if ($rows) {
            $max = (int) ($pdo->query("SELECT MAX(CAST(code AS INTEGER)) FROM customers WHERE code != ''")->fetchColumn() ?: 10000);
            $st = $pdo->prepare("UPDATE customers SET code = ? WHERE id = ?");
            foreach ($rows as $r) {
                $max++;
                $st->execute([(string) $max, (int) $r['id']]);
            }
        }
    }

    private function seed(): void
    {
        $pdo = $this->pdo;

        // 默认管理员
        $cnt = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE username='admin'")->fetchColumn();
        if ($cnt === 0) {
            $hash = password_hash('admin123', PASSWORD_BCRYPT);
            $st = $pdo->prepare("INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)");
            $st->execute(['admin', $hash, '管理员', 'admin']);
        }

        // 默认设置
        $defaults = [
            ['hide_supplier_brand_default', 'true', '客户报价单默认隐藏供应商品牌型号'],
            ['company_name', '星选建材', '对外公司抬头'],
            ['pdf_logo_path', '', '报价单 PDF logo 路径'],
            ['default_markup_pct', '15', '默认整单加价百分比'],
            ['default_quote_valid_days', '7', '默认报价有效天数'],
        ];
        $st = $pdo->prepare("INSERT OR IGNORE INTO system_settings (key, value, description) VALUES (?, ?, ?)");
        foreach ($defaults as $row) {
            $st->execute($row);
        }

        // 默认加价规则
        $cnt = (int) $pdo->query("SELECT COUNT(*) FROM markup_rules WHERE is_default=1")->fetchColumn();
        if ($cnt === 0) {
            $pdo->prepare("INSERT INTO markup_rules (name, type, value, is_default, remark) VALUES (?, ?, ?, 1, ?)")
                ->execute(['整单 +15%', 'flat_pct', 15, '默认策略，可在系统设置中修改']);
        }
    }
}
