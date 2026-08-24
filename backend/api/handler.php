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
$publicActions = ['login', 'publicGetInquiry', 'publicSubmitQuote', 'publicCreateInquiry', 'publicAiParseSupplierQuote',
    'vendorLogin', 'shelfMeta', 'shelfListProducts', 'shelfGetProduct', 'shelfLatestVideos', 'shelfBanners'];

// 供应商门户 action（供应商账户 token，与后台 users 隔离）
$vendorActions = ['vendorMe', 'vendorChangePassword', 'vendorListProducts', 'vendorSaveProduct',
    'vendorToggleProduct', 'vendorDeleteProduct', 'vendorUploadProductImage',
    'vendorAiParseProducts', 'vendorImportProductsExcel'];

$user = null;
$vendor = null;
if (in_array($action, $vendorActions, true)) {
    $vendor = requireVendorAuth($pdo);
} elseif (!in_array($action, $publicActions, true)) {
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
require_once __DIR__ . '/handlers/calendar.php';
require_once __DIR__ . '/handlers/order.php';
require_once __DIR__ . '/handlers/short_video.php';
require_once __DIR__ . '/handlers/workplan.php';
require_once __DIR__ . '/handlers/user_admin.php';
require_once __DIR__ . '/handlers/channel.php';
require_once __DIR__ . '/handlers/category.php';
require_once __DIR__ . '/handlers/banner.php';
require_once __DIR__ . '/handlers/shelf.php';
require_once __DIR__ . '/handlers/vendor.php';
require_once __DIR__ . '/handlers/product_admin.php';
require_once __DIR__ . '/handlers/payment_account.php';

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
    case 'createCasualQuote': handle_createCasualQuote($pdo, $input, $user); break;

    // ========== suppliers ==========
    case 'listSuppliers':   handle_listSuppliers($pdo, $input); break;
    case 'getSupplier':     handle_getSupplier($pdo, $input); break;
    case 'createSupplier':  handle_createSupplier($pdo, $input); break;
    case 'updateSupplier':  handle_updateSupplier($pdo, $input); break;
    case 'deleteSupplier':  handle_deleteSupplier($pdo, $input); break;

    // ========== inquiries ==========
    case 'listInquiries':       handle_listInquiries($pdo, $input); break;
    case 'getInquiryStatusFlow': handle_getInquiryStatusFlow($pdo, $input); break;
    case 'setInquiryPool':      handle_setInquiryPool($pdo, $input, $user); break;
    case 'getInquiry':          handle_getInquiry($pdo, $input); break;
    case 'createInquiry':       handle_createInquiry($pdo, $input, $user); break;
    case 'updateInquiry':       handle_updateInquiry($pdo, $input, $user); break;
    case 'updateInquiryBasic':  handle_updateInquiryBasic($pdo, $input, $user); break;
    case 'reorderInquiryItems': handle_reorderInquiryItems($pdo, $input, $user); break;
    case 'saveInquiryDelivery': handle_saveInquiryDelivery($pdo, $input, $user); break;
    case 'deleteInquiry':       handle_deleteInquiry($pdo, $input, $user); break;
    case 'dispatchInquiry':     handle_dispatchInquiry($pdo, $input, $user); break;
    case 'listDispatches':      handle_listDispatches($pdo, $input); break;
    case 'getDispatchCoverage': handle_getDispatchCoverage($pdo, $input); break;
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
    case 'previewQuoteOverwrite': handle_previewQuoteOverwrite($pdo, $input); break;
    case 'buildCustomerQuote':  handle_buildCustomerQuote($pdo, $input, $user); break;
    case 'sendCustomerQuote':   handle_sendCustomerQuote($pdo, $input, $user); break;
    case 'updateQuoteTerms':    handle_updateQuoteTerms($pdo, $input, $user); break;
    case 'updateQuoteItems':    handle_updateQuoteItems($pdo, $input, $user); break;
    case 'updateQuoteItemLeadTime': handle_updateQuoteItemLeadTime($pdo, $input, $user); break;
    case 'listQuoteRevisions':  handle_listQuoteRevisions($pdo, $input); break;
    case 'getQuoteSupplierBreakdown': handle_getQuoteSupplierBreakdown($pdo, $input); break;
    case 'deleteCustomerQuote': handle_deleteCustomerQuote($pdo, $input); break;
    case 'issueInvoice':         handle_issueInvoice($pdo, $input, $user); break;
    case 'markInvoicePaid':      handle_markInvoicePaid($pdo, $input, $user); break;
    case 'quickCreateInvoice':   handle_quickCreateInvoice($pdo, $input, $user); break;
    case 'convertSupplierQuote': handle_convertSupplierQuote($pdo, $input, $user); break;
    case 'listQuoteFollowLogs': handle_listQuoteFollowLogs($pdo, $input); break;
    case 'addQuoteFollowLog':   handle_addQuoteFollowLog($pdo, $input, $user); break;
    case 'deleteQuoteFollowLog': handle_deleteQuoteFollowLog($pdo, $input, $user); break;

    // ========== settings ==========
    case 'listSettings':    handle_listSettings($pdo); break;
    case 'updateSetting':   handle_updateSetting($pdo, $input, $user); break;
    case 'uploadSettingImage': handle_uploadSettingImage($pdo, $input, $user); break;

    // ========== 收款主体 / 收款账户 ==========
    case 'listPaymentEntities':  handle_listPaymentEntities($pdo, $input); break;
    case 'savePaymentEntity':    handle_savePaymentEntity($pdo, $input, $user); break;
    case 'deletePaymentEntity':  handle_deletePaymentEntity($pdo, $input, $user); break;
    case 'listPaymentAccounts':  handle_listPaymentAccounts($pdo, $input); break;
    case 'savePaymentAccount':   handle_savePaymentAccount($pdo, $input, $user); break;
    case 'deletePaymentAccount': handle_deletePaymentAccount($pdo, $input, $user); break;
    case 'uploadPaymentImage':   handle_uploadPaymentImage($pdo, $input, $user); break;

    // ========== markup rules ==========
    case 'listMarkupRules':   handle_listMarkupRules($pdo); break;
    case 'createMarkupRule':  handle_createMarkupRule($pdo, $input, $user); break;
    case 'updateMarkupRule':  handle_updateMarkupRule($pdo, $input); break;
    case 'deleteMarkupRule':  handle_deleteMarkupRule($pdo, $input); break;

    // ========== dashboard ==========
    case 'dashboardOverview': handle_dashboardOverview($pdo); break;
    case 'dashboardIdleCustomers': handle_dashboardIdleCustomers($pdo, $input); break;
    case 'dashboardDealRanking': handle_dashboardDealRanking($pdo); break;

    // ========== AI ==========
    case 'aiParseInquiryText': handle_aiParseInquiryText($pdo, $input, $user); break;
    case 'aiParseSupplierQuoteForInquiry': handle_aiParseSupplierQuoteForInquiry($pdo, $input, $user); break;

    // ========== 日历 / 日记 ==========
    case 'listCalendarEvents':   handle_listCalendarEvents($pdo, $input, $user); break;
    case 'createCalendarEvent':  handle_createCalendarEvent($pdo, $input, $user); break;
    case 'updateCalendarEvent':  handle_updateCalendarEvent($pdo, $input, $user); break;
    case 'deleteCalendarEvent':  handle_deleteCalendarEvent($pdo, $input, $user); break;
    case 'getDiary':             handle_getDiary($pdo, $input, $user); break;
    case 'saveDiary':            handle_saveDiary($pdo, $input, $user); break;
    case 'listDiaryEntries':     handle_listDiaryEntries($pdo, $input, $user); break;

    // ========== 工作计划 ==========
    case 'listWorkPlans':        handle_listWorkPlans($pdo, $input, $user); break;
    case 'workPlanCalendar':     handle_workPlanCalendar($pdo, $input, $user); break;
    case 'listTeamWorkPlans':    handle_listTeamWorkPlans($pdo, $input, $user); break;
    case 'saveWorkPlan':         handle_saveWorkPlan($pdo, $input, $user); break;
    case 'deleteWorkPlan':       handle_deleteWorkPlan($pdo, $input, $user); break;
    case 'toggleWorkPlanDone':   handle_toggleWorkPlanDone($pdo, $input, $user); break;
    case 'searchInquiries':      handle_searchInquiries($pdo, $input); break;

    // ========== 渠道管理 ==========
    case 'listChannels':         handle_listChannels($pdo, $input); break;
    case 'saveChannel':          handle_saveChannel($pdo, $input, $user); break;
    case 'toggleChannelActive':  handle_toggleChannelActive($pdo, $input); break;
    case 'deleteChannel':        handle_deleteChannel($pdo, $input); break;

    // ========== 账户管理 / 权限（仅 admin） ==========
    case 'listUsers':            handle_listUsers($pdo, $user); break;
    case 'saveUser':             handle_saveUser($pdo, $input, $user); break;
    case 'resetUserPassword':    handle_resetUserPassword($pdo, $input, $user); break;
    case 'toggleUserActive':     handle_toggleUserActive($pdo, $input, $user); break;
    case 'deleteUser':           handle_deleteUser($pdo, $input, $user); break;
    case 'getRolePermissions':   handle_getRolePermissions($pdo); break;
    case 'saveRolePermissions':  handle_saveRolePermissions($pdo, $input, $user); break;

    // ========== 订单履约 ==========
    case 'setDealStatus':        handle_setDealStatus($pdo, $input, $user); break;
    case 'listOrders':           handle_listOrders($pdo, $input); break;
    case 'listOrderSuppliers':   handle_listOrderSuppliers($pdo); break;
    case 'bulkUpdateOrderSupplier': handle_bulkUpdateOrderSupplier($pdo, $input, $user); break;
    case 'bulkDeleteOrders':     handle_bulkDeleteOrders($pdo, $input, $user); break;
    case 'getOrder':             handle_getOrder($pdo, $input); break;
    case 'updateOrder':          handle_updateOrder($pdo, $input, $user); break;
    case 'createContract':       handle_createContract($pdo, $input, $user); break;
    case 'updateContract':       handle_updateContract($pdo, $input, $user); break;
    case 'deleteContract':       handle_deleteContract($pdo, $input, $user); break;
    case 'addPayment':           handle_addPayment($pdo, $input, $user); break;
    case 'deletePayment':        handle_deletePayment($pdo, $input, $user); break;
    case 'confirmPayment':       handle_confirmPayment($pdo, $input, $user); break;
    case 'unconfirmPayment':     handle_unconfirmPayment($pdo, $input, $user); break;
    case 'listPendingPayments':  handle_listPendingPayments($pdo, $input, $user); break;
    case 'listReceivables':      handle_listReceivables($pdo, $input, $user); break;
    case 'listRefunds':          handle_listRefunds($pdo, $input, $user); break;
    case 'createRefund':         handle_createRefund($pdo, $input, $user); break;
    case 'handleRefund':         handle_handleRefund($pdo, $input, $user); break;
    case 'deleteRefund':         handle_deleteRefund($pdo, $input, $user); break;
    case 'addCommission':        handle_addCommission($pdo, $input, $user); break;
    case 'updateCommission':     handle_updateCommission($pdo, $input, $user); break;
    case 'deleteCommission':     handle_deleteCommission($pdo, $input, $user); break;
    case 'listSalespersons':     handle_listSalespersons($pdo); break;
    case 'createSalesperson':    handle_createSalesperson($pdo, $input, $user); break;
    case 'updateSalesperson':    handle_updateSalesperson($pdo, $input); break;
    case 'deleteSalesperson':    handle_deleteSalesperson($pdo, $input); break;
    case 'uploadVoucher':        handle_uploadVoucher($pdo, $input, $user); break;
    case 'completeOrder':        handle_completeOrder($pdo, $input, $user); break;
    case 'importHistoricalOrder': handle_importHistoricalOrder($pdo, $input, $user); break;
    case 'importHistoricalOrdersBatch': handle_importHistoricalOrdersBatch($pdo, $input, $user); break;
    case 'downloadOrderImportTemplate': handle_downloadOrderImportTemplate($pdo); break;
    case 'aiParseHistoricalOrderImage': handle_aiParseHistoricalOrderImage($pdo, $input, $user); break;
    case 'importHistoricalOrdersFromJson': handle_importHistoricalOrdersFromJson($pdo, $input, $user); break;

    // ========== 短视频矩阵 ==========
    case 'listSvAssets':         handle_listSvAssets($pdo, $input); break;
    case 'getSvAsset':           handle_getSvAsset($pdo, $input); break;
    case 'createSvAsset':        handle_createSvAsset($pdo, $input, $user); break;
    case 'updateSvAsset':        handle_updateSvAsset($pdo, $input, $user); break;
    case 'deleteSvAsset':        handle_deleteSvAsset($pdo, $input, $user); break;
    case 'uploadSvFile':         handle_uploadSvFile($pdo, $input, $user); break;
    case 'aiGeneratePlatformCopy': handle_aiGeneratePlatformCopy($pdo, $input, $user); break;
    case 'listSvAccounts':       handle_listSvAccounts($pdo, $input); break;
    case 'createSvAccount':      handle_createSvAccount($pdo, $input, $user); break;
    case 'updateSvAccount':      handle_updateSvAccount($pdo, $input); break;
    case 'deleteSvAccount':      handle_deleteSvAccount($pdo, $input); break;
    case 'listSvTasks':          handle_listSvTasks($pdo, $input); break;
    case 'createSvTasks':        handle_createSvTasks($pdo, $input, $user); break;
    case 'updateSvTask':         handle_updateSvTask($pdo, $input, $user); break;
    case 'deleteSvTask':         handle_deleteSvTask($pdo, $input); break;
    case 'svDashboard':          handle_svDashboard($pdo); break;
    case 'aiParseInquiryFile': handle_aiParseInquiryFile($pdo, $input, $user); break;

    // ========== 电子货架（公开） ==========
    case 'shelfMeta':          handle_shelfMeta($pdo); break;
    case 'shelfListProducts':  handle_shelfListProducts($pdo, $input); break;
    case 'shelfGetProduct':    handle_shelfGetProduct($pdo, $input); break;
    case 'shelfLatestVideos':  handle_shelfLatestVideos($pdo, $input); break;
    case 'shelfBanners':       handle_shelfBanners($pdo); break;
    case 'adminListBanners':   handle_adminListBanners($pdo, $user); break;
    case 'uploadBannerImage':  handle_uploadBannerImage($pdo, $input, $user); break;
    case 'saveBanner':         handle_saveBanner($pdo, $input, $user); break;
    case 'moveBanner':         handle_moveBanner($pdo, $input, $user); break;
    case 'deleteBanner':       handle_deleteBanner($pdo, $input, $user); break;

    // ========== 供应商门户 ==========
    case 'vendorLogin':              handle_vendorLogin($pdo, $input); break;
    case 'vendorMe':                 handle_vendorMe($pdo, $vendor); break;
    case 'vendorChangePassword':     handle_vendorChangePassword($pdo, $input, $vendor); break;
    case 'vendorListProducts':       handle_vendorListProducts($pdo, $input, $vendor); break;
    case 'vendorSaveProduct':        handle_vendorSaveProduct($pdo, $input, $vendor); break;
    case 'vendorToggleProduct':      handle_vendorToggleProduct($pdo, $input, $vendor); break;
    case 'vendorDeleteProduct':      handle_vendorDeleteProduct($pdo, $input, $vendor); break;
    case 'vendorUploadProductImage': handle_vendorUploadProductImage($pdo, $input, $vendor); break;
    case 'vendorAiParseProducts':    handle_vendorAiParseProducts($pdo, $input, $vendor); break;
    case 'vendorImportProductsExcel': handle_vendorImportProductsExcel($pdo, $input, $vendor); break;

    // ========== 商品库管理（后台） ==========
    case 'adminListProducts':   handle_adminListProducts($pdo, $input); break;
    case 'adminSaveProduct':    handle_adminSaveProduct($pdo, $input, $user); break;
    case 'adminReviewProduct':  handle_adminReviewProduct($pdo, $input, $user); break;
    case 'adminDeleteProduct':  handle_adminDeleteProduct($pdo, $input, $user); break;
    case 'adminListPriceLogs':  handle_adminListPriceLogs($pdo, $input); break;
    case 'adminUploadProductImage': handle_adminUploadProductImage($pdo, $input, $user); break;
    case 'seedDemoProducts':    handle_seedDemoProducts($pdo, $user); break;
    case 'clearDemoProducts':   handle_clearDemoProducts($pdo, $user); break;
    case 'setSupplierPortal':   handle_setSupplierPortal($pdo, $input, $user); break;

    // ========== 品类管理（两级） ==========
    case 'listCategories':      handle_listCategories($pdo); break;
    case 'saveCategory':        handle_saveCategory($pdo, $input, $user); break;
    case 'moveCategory':        handle_moveCategory($pdo, $input, $user); break;
    case 'deleteCategory':      handle_deleteCategory($pdo, $input, $user); break;

    // ========== public (token / 公开) ==========
    case 'publicGetInquiry':   handle_publicGetInquiry($pdo, $input); break;
    case 'publicSubmitQuote':  handle_publicSubmitQuote($pdo, $input); break;
    case 'publicCreateInquiry': handle_publicCreateInquiry($pdo, $input); break;
    case 'publicAiParseSupplierQuote': handle_publicAiParseSupplierQuote($pdo, $input); break;

    default:
        jsonError('未知 action: ' . $action, 404);
}
