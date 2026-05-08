<?php
/**
 * 星选建材 REST API 入口
 * 风格：action-based 单入口，前端用 ?action=xxx 调用
 *
 * 公开 action（无需登录）：login / publicGetInquiry / publicSubmitQuote
 * 其余 action 必须带 Authorization: Bearer <token>
 */

@date_default_timezone_set('Asia/Shanghai');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/helpers.php';

$db = Database::getInstance();
$db->initialize();
$pdo = $db->getConnection();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// 解析输入
$input = [];
if ($method === 'POST' || $method === 'PUT' || $method === 'DELETE') {
    if (!empty($_FILES)) {
        $input = $_POST;
    } else {
        $raw = file_get_contents('php://input');
        if ($raw) $input = json_decode($raw, true) ?: [];
    }
}
$input = array_merge($_GET, $input);
unset($input['action']);

// 公开 action 白名单
$publicActions = ['login', 'publicGetInquiry', 'publicSubmitQuote', 'publicCreateInquiry', 'publicAiParseSupplierQuote'];

$user = null;
if (!in_array($action, $publicActions, true)) {
    $user = requireAuth($pdo);
}

require_once __DIR__ . '/handlers/auth.php';
require_once __DIR__ . '/handlers/customer.php';
require_once __DIR__ . '/handlers/supplier.php';
require_once __DIR__ . '/handlers/inquiry.php';
require_once __DIR__ . '/handlers/supplier_quote.php';
require_once __DIR__ . '/handlers/customer_quote.php';
require_once __DIR__ . '/handlers/setting.php';
require_once __DIR__ . '/handlers/markup_rule.php';
require_once __DIR__ . '/handlers/dashboard.php';
require_once __DIR__ . '/handlers/public_quote.php';
require_once __DIR__ . '/handlers/ai.php';

switch ($action) {
    // ========== auth ==========
    case 'login':           handle_login($pdo, $input); break;
    case 'me':              handle_me($pdo, $user); break;
    case 'changePassword':  handle_changePassword($pdo, $input, $user); break;
    case 'updateProfile':   handle_updateProfile($pdo, $input, $user); break;

    // ========== customers ==========
    case 'listCustomers':   handle_listCustomers($pdo, $input); break;
    case 'getCustomer':     handle_getCustomer($pdo, $input); break;
    case 'createCustomer':  handle_createCustomer($pdo, $input, $user); break;
    case 'updateCustomer':  handle_updateCustomer($pdo, $input); break;
    case 'deleteCustomer':  handle_deleteCustomer($pdo, $input); break;

    // ========== suppliers ==========
    case 'listSuppliers':   handle_listSuppliers($pdo, $input); break;
    case 'getSupplier':     handle_getSupplier($pdo, $input); break;
    case 'createSupplier':  handle_createSupplier($pdo, $input); break;
    case 'updateSupplier':  handle_updateSupplier($pdo, $input); break;
    case 'deleteSupplier':  handle_deleteSupplier($pdo, $input); break;

    // ========== inquiries ==========
    case 'listInquiries':       handle_listInquiries($pdo, $input); break;
    case 'getInquiry':          handle_getInquiry($pdo, $input); break;
    case 'createInquiry':       handle_createInquiry($pdo, $input, $user); break;
    case 'updateInquiry':       handle_updateInquiry($pdo, $input, $user); break;
    case 'deleteInquiry':       handle_deleteInquiry($pdo, $input); break;
    case 'dispatchInquiry':     handle_dispatchInquiry($pdo, $input, $user); break;
    case 'listDispatches':      handle_listDispatches($pdo, $input); break;
    case 'shareLinks':          handle_shareLinks($pdo, $input); break;
    case 'compareInquiry':      handle_compareInquiry($pdo, $input); break;
    case 'uploadInquiryAttachment': handle_uploadInquiryAttachment($pdo, $input); break;
    case 'exportInquiryExcel':  handle_exportInquiryExcel($pdo, $input); break;

    // ========== supplier quotes ==========
    case 'listSupplierQuotes':  handle_listSupplierQuotes($pdo, $input); break;
    case 'getSupplierQuote':    handle_getSupplierQuote($pdo, $input); break;
    case 'adoptSupplierQuote':  handle_adoptSupplierQuote($pdo, $input, $user); break;
    case 'voidSupplierQuote':   handle_voidSupplierQuote($pdo, $input, $user); break;
    case 'internalSubmitQuote': handle_internalSubmitQuote($pdo, $input, $user); break;

    // ========== customer quotes ==========
    case 'listCustomerQuotes':  handle_listCustomerQuotes($pdo, $input); break;
    case 'getCustomerQuote':    handle_getCustomerQuote($pdo, $input); break;
    case 'buildCustomerQuote':  handle_buildCustomerQuote($pdo, $input, $user); break;
    case 'sendCustomerQuote':   handle_sendCustomerQuote($pdo, $input, $user); break;
    case 'deleteCustomerQuote': handle_deleteCustomerQuote($pdo, $input); break;
    case 'listQuoteFollowLogs': handle_listQuoteFollowLogs($pdo, $input); break;
    case 'addQuoteFollowLog':   handle_addQuoteFollowLog($pdo, $input, $user); break;
    case 'deleteQuoteFollowLog': handle_deleteQuoteFollowLog($pdo, $input, $user); break;

    // ========== settings ==========
    case 'listSettings':    handle_listSettings($pdo); break;
    case 'updateSetting':   handle_updateSetting($pdo, $input, $user); break;

    // ========== markup rules ==========
    case 'listMarkupRules':   handle_listMarkupRules($pdo); break;
    case 'createMarkupRule':  handle_createMarkupRule($pdo, $input, $user); break;
    case 'updateMarkupRule':  handle_updateMarkupRule($pdo, $input); break;
    case 'deleteMarkupRule':  handle_deleteMarkupRule($pdo, $input); break;

    // ========== dashboard ==========
    case 'dashboardOverview': handle_dashboardOverview($pdo); break;

    // ========== AI ==========
    case 'aiParseInquiryText': handle_aiParseInquiryText($pdo, $input, $user); break;
    case 'aiParseInquiryFile': handle_aiParseInquiryFile($pdo, $input, $user); break;

    // ========== public (token / 公开) ==========
    case 'publicGetInquiry':   handle_publicGetInquiry($pdo, $input); break;
    case 'publicSubmitQuote':  handle_publicSubmitQuote($pdo, $input); break;
    case 'publicCreateInquiry': handle_publicCreateInquiry($pdo, $input); break;
    case 'publicAiParseSupplierQuote': handle_publicAiParseSupplierQuote($pdo, $input); break;

    default:
        jsonError('未知 action: ' . $action, 404);
}
