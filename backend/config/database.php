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

        // 业务员 / 渠道合伙人（简单通讯录）
        $pdo->exec("CREATE TABLE IF NOT EXISTS salespersons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'sales',
            phone TEXT DEFAULT '',
            wechat TEXT DEFAULT '',
            commission_default_pct REAL DEFAULT 5,
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        // 订单（成交后生成）
        $pdo->exec("CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no TEXT NOT NULL UNIQUE,
            quote_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_contract',
            total_amount REAL DEFAULT 0,
            currency TEXT DEFAULT 'IDR',
            salesperson_id INTEGER,
            channel_partner_id INTEGER,
            commission_rule_json TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (quote_id) REFERENCES customer_quotes(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_orders_quote ON orders(quote_id)");

        // 合同
        $pdo->exec("CREATE TABLE IF NOT EXISTS contracts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            version INTEGER DEFAULT 1,
            clauses_json TEXT DEFAULT '',
            content_cn TEXT DEFAULT '',
            content_id TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            signed_pdf_path TEXT DEFAULT '',
            signed_at TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_contracts_order ON contracts(order_id)");

        // 付款
        $pdo->exec("CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            type TEXT DEFAULT 'deposit',
            amount REAL NOT NULL,
            method TEXT DEFAULT '',
            paid_at TEXT,
            voucher_path TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)");

        // 返佣
        $pdo->exec("CREATE TABLE IF NOT EXISTS commissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            beneficiary_id INTEGER,
            beneficiary_name TEXT DEFAULT '',
            rule_snapshot TEXT DEFAULT '',
            amount REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            settled_at TEXT,
            voucher_path TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id)");

        // ============ 短视频矩阵 ============
        $pdo->exec("CREATE TABLE IF NOT EXISTS sv_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT DEFAULT '',
            video_path TEXT DEFAULT '',
            cover_path TEXT DEFAULT '',
            description TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            duration INTEGER DEFAULT 0,
            size_bytes INTEGER DEFAULT 0,
            platform_copies TEXT DEFAULT '',
            created_by INTEGER,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS sv_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            account_name TEXT NOT NULL,
            handle TEXT DEFAULT '',
            owner_phone TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            followers INTEGER DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sv_accounts_platform ON sv_accounts(platform)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS sv_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            scheduled_at TEXT NOT NULL,
            status TEXT DEFAULT 'scheduled',
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            executed_at TEXT,
            external_task_id TEXT DEFAULT '',
            error TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (asset_id) REFERENCES sv_assets(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES sv_accounts(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sv_tasks_sched ON sv_tasks(scheduled_at, status)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sv_tasks_asset ON sv_tasks(asset_id)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            start_at TEXT NOT NULL,
            end_at TEXT,
            all_day INTEGER NOT NULL DEFAULT 0,
            category TEXT DEFAULT 'other',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_cal_user_start ON calendar_events(user_id, start_at)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS diary_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            content TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(user_id, date)
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_diary_user_date ON diary_entries(user_id, date)");

        $pdo->exec("CREATE TABLE IF NOT EXISTS quote_follow_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL,
            user_id INTEGER,
            user_name TEXT DEFAULT '',
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (quote_id) REFERENCES customer_quotes(id) ON DELETE CASCADE
        )");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_qfl_qid ON quote_follow_logs(quote_id)");

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

        // 客户报价单加 tax_included / tax_rate / currency 列（沿用自所选供应商报价）
        $qcols = array_column($pdo->query("PRAGMA table_info(customer_quotes)")->fetchAll(), 'name');
        if (!in_array('tax_included', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN tax_included INTEGER NOT NULL DEFAULT 1");
        }
        if (!in_array('tax_rate', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0.11");
        }
        if (!in_array('currency', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR'");
        }
        // 发票字段
        if (!in_array('invoice_no', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_no TEXT DEFAULT ''");
        }
        if (!in_array('invoice_issued_at', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_issued_at TEXT");
        }
        if (!in_array('invoice_due_at', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_due_at TEXT");
        }
        if (!in_array('paid_at', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN paid_at TEXT");
        }
        // 成交状态
        if (!in_array('deal_status', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN deal_status TEXT DEFAULT 'pending'");
        }
        if (!in_array('won_at', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN won_at TEXT");
        }
        if (!in_array('lost_at', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN lost_at TEXT");
        }
        if (!in_array('lost_reason', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN lost_reason TEXT DEFAULT ''");
        }
        // 发票收款账户快照（覆盖系统默认）
        if (!in_array('invoice_bank_name', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_bank_name TEXT DEFAULT ''");
        }
        if (!in_array('invoice_bank_account_no', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_bank_account_no TEXT DEFAULT ''");
        }
        if (!in_array('invoice_bank_account_name', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_bank_account_name TEXT DEFAULT ''");
        }
        if (!in_array('invoice_bank_swift', $qcols, true)) {
            $pdo->exec("ALTER TABLE customer_quotes ADD COLUMN invoice_bank_swift TEXT DEFAULT ''");
        }

        // orders 加 completed_at / completion_voucher_path
        $ocols = array_column($pdo->query("PRAGMA table_info(orders)")->fetchAll(), 'name');
        if ($ocols) {
            if (!in_array('completed_at', $ocols, true)) {
                $pdo->exec("ALTER TABLE orders ADD COLUMN completed_at TEXT");
            }
            if (!in_array('completion_voucher_path', $ocols, true)) {
                $pdo->exec("ALTER TABLE orders ADD COLUMN completion_voucher_path TEXT DEFAULT ''");
            }
            if (!in_array('completion_remark', $ocols, true)) {
                $pdo->exec("ALTER TABLE orders ADD COLUMN completion_remark TEXT DEFAULT ''");
            }
        }
        // contracts 加 clauses_json
        $ccols = array_column($pdo->query("PRAGMA table_info(contracts)")->fetchAll(), 'name');
        if ($ccols && !in_array('clauses_json', $ccols, true)) {
            $pdo->exec("ALTER TABLE contracts ADD COLUMN clauses_json TEXT DEFAULT ''");
        }

        // 供应商报价单加同样三列（继承自询价单设置；保留以便审计）
        $sqcols = array_column($pdo->query("PRAGMA table_info(supplier_quotes)")->fetchAll(), 'name');
        if (!in_array('tax_included', $sqcols, true)) {
            $pdo->exec("ALTER TABLE supplier_quotes ADD COLUMN tax_included INTEGER NOT NULL DEFAULT 1");
        }
        if (!in_array('tax_rate', $sqcols, true)) {
            $pdo->exec("ALTER TABLE supplier_quotes ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0.11");
        }
        if (!in_array('currency', $sqcols, true)) {
            $pdo->exec("ALTER TABLE supplier_quotes ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR'");
        }

        // 询价单：销售派单前设置货币/含税/税率，所有下游沿用
        $icols = array_column($pdo->query("PRAGMA table_info(inquiries)")->fetchAll(), 'name');
        if (!in_array('tax_included', $icols, true)) {
            $pdo->exec("ALTER TABLE inquiries ADD COLUMN tax_included INTEGER NOT NULL DEFAULT 1");
        }
        if (!in_array('tax_rate', $icols, true)) {
            $pdo->exec("ALTER TABLE inquiries ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0.11");
        }
        if (!in_array('currency', $icols, true)) {
            $pdo->exec("ALTER TABLE inquiries ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR'");
        }

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
            ['invoice_no_prefix', 'INV', '发票号前缀'],
            ['invoice_due_days', '7', '默认账期天数'],
            ['bank_name', 'BCA', '收款银行'],
            ['bank_account_no', '2880650567', '银行账号'],
            ['bank_account_name', 'zhangweiqi', '账户名'],
            ['bank_swift', '', 'SWIFT 代码'],
            ['company_address', '', '公司地址'],
            ['company_phone', '', '公司电话'],
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
