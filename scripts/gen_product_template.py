#!/usr/bin/env python3
"""
生成「供应商产品信息收集表」Excel 模板 → frontend/public/templates/product-template.xlsx

用法：python3 scripts/gen_product_template.py
改了字段或说明后重跑一次，再 npm run build（public/ 会被 vite 原样拷进 dist）。

表头设计原则：
- 每个表头都包含后端 vendor.php aliasMap 里的别名（如「品名」「供货价」），
  供应商填完直接用门户「Excel 导入」就能识别，不用改列名
- 中文｜印尼文双语，供应商两边都看得懂
- 字段参考京东工采（buy.jdindustry.com）工业品 B2B 标准 + 建材行业特点（SNI 认证、包装规格）
"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parents[1] / 'frontend' / 'public' / 'templates' / 'product-template.xlsx'

CATEGORIES = [
    '安全防护', '电工电气', '卫浴照明', '五金紧固', '工具耗材', '给水排水', '消防暖通',
    '防水保温', '装饰材料', '日杂用品', '建筑钢材', '机械设备', '办公用品',
]
UNITS = ['件', '个', '套', '箱', '袋', '包', '桶', '卷', '根', '支', '张', '块', '片', '米', '平方米', '立方米', '吨', '公斤', '升']
STOCK = ['有现货', '需订货', '可定制']

# (表头, 必填, 列宽, 填写说明, 示例)
COLUMNS = [
    ('品名 *\nNama Produk',           True,  26, '产品名称，不含数量和单位。如「抛光瓷砖」「PVC 给水管」', '抛光瓷砖'),
    ('品类 *\nKategori',              True,  14, '从下拉选一个大类，见「填写说明」页的品类表', '装饰材料'),
    ('品牌\nMerek',                   False, 14, '产品品牌，无品牌填「无」', 'Roman'),
    ('型号\nModel / Tipe',            False, 16, '厂家型号或货号', 'RG6060'),
    ('规格\nSpesifikasi',             False, 24, '尺寸 / 功率 / 颜色 / 厚度等关键参数，多项用「/」分隔', '600×600mm / 亮面 / 米白'),
    ('材质\nMaterial',                False, 14, '主要材质，如 瓷质 / PVC / 304不锈钢 / 镀锌钢', '瓷质'),
    ('单位\nSatuan',                  False, 10, '报价对应的计量单位，从下拉选', '箱'),
    ('包装规格\nKemasan',             False, 16, '一个销售单位里装多少，如「4片/箱」「50kg/袋」', '4片/箱（1.44㎡）'),
    ('供货价 *\nHarga (IDR)',         True,  16, '给星选的供货价，印尼盾，未税，只填数字不要加逗号或 Rp', 185000),
    ('起订量\nMOQ',                   False, 10, '最少订购多少个「单位」，不限填 1', 50),
    ('现货\nStok',                    False, 12, '从下拉选：有现货 / 需订货 / 可定制', '有现货'),
    ('交期\nWaktu Pengiriman',        False, 14, '下单后多久能发货，如「3-5天」「现货当天」「15天」', '3-5天'),
    ('产地\nAsal Produk',             False, 12, '生产地，国家或城市', 'Indonesia'),
    ('重量\nBerat',                   False, 12, '单个销售单位的重量，带单位，如「28kg/箱」', '28kg/箱'),
    ('认证 / 标准\nSertifikasi',       False, 16, 'SNI / ISO / CE 等，多个用「/」分隔，无则留空', 'SNI'),
    ('质保期\nGaransi',               False, 12, '如「1年」「3年」，无则留空', '1年'),
    ('运费说明\nOngkir',              False, 18, '含运 / 不含运 / 雅加达区域包邮 等', '雅加达含运，外岛另计'),
    ('图片链接\nLink Gambar',         False, 36, '产品图 URL，多张用英文逗号分隔；系统会自动下载入库', 'https://example.com/a.jpg,https://example.com/b.jpg'),
    ('描述\nDeskripsi',               False, 36, '其他需要说明的：用途 / 优势 / 注意事项', '适用于客厅、卧室地面，耐磨防滑'),
]

HEAD_FILL = PatternFill('solid', fgColor='1D57E0')
REQ_FILL = PatternFill('solid', fgColor='D93025')
HINT_FILL = PatternFill('solid', fgColor='F5F7FA')
EXAMPLE_FILL = PatternFill('solid', fgColor='FFF9E6')
WHITE_BOLD = Font(name='Arial', bold=True, color='FFFFFF', size=11)
THIN = Side(style='thin', color='D0D5DD')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build_guide(ws):
    ws.title = '填写说明 Petunjuk'
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 90
    rows = [
        ('供应商产品信息收集表', None),
        ('Formulir Pengumpulan Informasi Produk Pemasok', None),
        ('', None),
        ('用途 / Tujuan', '请在「产品信息 Produk」页逐行填写贵司可供应的产品。填完后交给星选对接人，或登录供应商门户用「Excel 导入」自助上传。\n'
                          'Isi produk yang dapat Anda pasok di sheet「产品信息 Produk」, satu baris satu produk. Kirim ke PIC Xingxuan atau unggah sendiri lewat portal pemasok.'),
        ('必填项 / Wajib', '带 * 的三列必填：品名、品类、供货价。缺任何一项该行会被跳过。\n'
                          'Kolom bertanda * wajib diisi: Nama Produk, Kategori, Harga. Baris tanpa salah satunya akan dilewati.'),
        ('价格 / Harga', '供货价 = 给星选的价格，印尼盾（IDR），未税，只填数字（如 185000），不要加逗号、Rp 或「万」。\n'
                        'Harga adalah harga ke Xingxuan, dalam IDR, belum termasuk pajak, angka saja.'),
        ('表头 / Judul', '请不要修改或删除第一行表头，也不要调换列顺序，系统按表头识别。可以删掉示例行。\n'
                        'Jangan mengubah / menghapus baris judul atau mengubah urutan kolom. Baris contoh boleh dihapus.'),
        ('图片 / Gambar', '「图片链接」填公网可访问的 URL，多张用英文逗号分隔。也可以先不填，导入后在门户里逐个上传。\n'
                        'Isi URL gambar yang dapat diakses publik, pisahkan dengan koma. Boleh dikosongkan dan diunggah nanti.'),
        ('一行一品 / Satu baris satu produk', '同一产品不同规格（如 600×600 和 800×800）请分成两行，不要写在一格里。\n'
                                              'Produk yang sama dengan spesifikasi berbeda diisi di baris terpisah.'),
        ('', None),
        ('品类清单 / Daftar Kategori', '　'.join(CATEGORIES)),
        ('单位 / Satuan', '　'.join(UNITS)),
        ('现货 / Stok', '　'.join(STOCK)),
        ('', None),
        ('各列说明 / Keterangan Kolom', None),
    ]
    r = 1
    for k, v in rows:
        if k and v is None:
            c = ws.cell(row=r, column=1, value=k)
            c.font = Font(name='Arial', bold=True, size=14 if r <= 2 else 12, color='1D57E0' if r <= 2 else '111111')
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        elif k:
            a = ws.cell(row=r, column=1, value=k)
            a.font = Font(name='Arial', bold=True, size=10)
            a.alignment = Alignment(vertical='top', wrap_text=True)
            a.fill = HINT_FILL
            b = ws.cell(row=r, column=2, value=v)
            b.font = Font(name='Arial', size=10)
            b.alignment = Alignment(vertical='top', wrap_text=True)
            ws.row_dimensions[r].height = max(30, 15 * (v.count('\n') + 1) + 6)
        r += 1
    # 各列说明表
    ws.cell(row=r, column=1, value='列名 / Kolom').font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
    ws.cell(row=r, column=2, value='怎么填 / Cara mengisi').font = Font(name='Arial', bold=True, size=10, color='FFFFFF')
    ws.cell(row=r, column=1).fill = HEAD_FILL
    ws.cell(row=r, column=2).fill = HEAD_FILL
    r += 1
    for head, req, _w, hint, _ex in COLUMNS:
        a = ws.cell(row=r, column=1, value=head.replace('\n', ' '))
        a.font = Font(name='Arial', size=10, bold=req, color='D93025' if req else '111111')
        a.alignment = Alignment(vertical='top', wrap_text=True)
        b = ws.cell(row=r, column=2, value=hint)
        b.font = Font(name='Arial', size=10)
        b.alignment = Alignment(vertical='top', wrap_text=True)
        a.border = BORDER
        b.border = BORDER
        r += 1
    ws.freeze_panes = 'A4'


def build_sheet(ws):
    ws.title = '产品信息 Produk'
    # 表头
    for i, (head, req, width, _hint, _ex) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=1, column=i, value=head)
        c.font = WHITE_BOLD
        c.fill = REQ_FILL if req else HEAD_FILL
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = BORDER
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[1].height = 34

    # 示例行（浅黄底，供应商可删）
    for i, (_h, _r, _w, _hint, ex) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=2, column=i, value=ex)
        c.fill = EXAMPLE_FILL
        c.font = Font(name='Arial', size=10, color='7A6A2E', italic=True)
        c.alignment = Alignment(vertical='center', wrap_text=True)
        c.border = BORDER
    ws.cell(row=2, column=1).value = '【示例，可删】抛光瓷砖'

    # 预留 300 行格式
    for r in range(3, 303):
        for i in range(1, len(COLUMNS) + 1):
            c = ws.cell(row=r, column=i)
            c.border = BORDER
            c.font = Font(name='Arial', size=10)
            c.alignment = Alignment(vertical='center', wrap_text=True)

    # 下拉：品类 / 单位 / 现货
    def add_list(col_idx, options):
        dv = DataValidation(type='list', formula1='"' + ','.join(options) + '"', allow_blank=True)
        dv.error = '请从下拉选择'
        dv.errorTitle = '无效值'
        ws.add_data_validation(dv)
        col = get_column_letter(col_idx)
        dv.add(f'{col}2:{col}302')

    heads = [c[0] for c in COLUMNS]
    add_list(heads.index('品类 *\nKategori') + 1, CATEGORIES)
    add_list(heads.index('单位\nSatuan') + 1, UNITS)
    add_list(heads.index('现货\nStok') + 1, STOCK)

    # 价格 / 起订量 数值校验
    price_col = get_column_letter(heads.index('供货价 *\nHarga (IDR)') + 1)
    dv_num = DataValidation(type='decimal', operator='greaterThan', formula1='0', allow_blank=True)
    dv_num.error = '供货价只填数字，大于 0'
    dv_num.errorTitle = '无效价格'
    ws.add_data_validation(dv_num)
    dv_num.add(f'{price_col}2:{price_col}302')

    ws.freeze_panes = 'B2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(COLUMNS))}1'


def main():
    wb = Workbook()
    # 产品表放第一页：导入解析器会优先找带表头的 sheet，但老版本只读首页，
    # 放第一页两边都兼容；说明页放第二页，供应商点 tab 就能看到
    build_sheet(wb.active)
    build_guide(wb.create_sheet())
    wb.active = 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f'已生成 {OUT.relative_to(OUT.parents[3])}  （{OUT.stat().st_size:,} 字节，{len(COLUMNS)} 列）')


if __name__ == '__main__':
    main()
