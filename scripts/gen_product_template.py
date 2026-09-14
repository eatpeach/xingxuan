#!/usr/bin/env python3
"""
生成「供应商产品信息收集表」→ frontend/public/templates/product-template.xlsx

用法：python3 scripts/gen_product_template.py
改了字段或说明后重跑一次，再 npm run build（public/ 会被 vite 原样拷进 dist）。

这是一份直接发给供应商的正式表格（中文 / 印尼文双语），三页：
  1. 产品清单   — 供应商逐行填产品，首行表头（导入解析器按此识别）
  2. 供应商信息 — 公司 / 联系人 / 资质，一次填
  3. 填写说明   — 必填项、价格口径、品类清单、各列说明

字段参考京东工采（buy.jdindustry.com）供应商商品资料的完整度，
按建材行业调整（SNI 认证、包装规格、印尼盾计价）。
产品清单的每个表头都含后端 vendor.php aliasMap 里的别名，供应商填完可直接走门户「Excel 导入」；
系统不认的列（市场参考价 / 颜色 / 售后 等）导入时会跳过，不影响。
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

# 分组 → [(表头, 必填, 列宽, 说明, 示例)]
# ⚠ 表头里的中文要能被 vendor.php aliasMap 识别；「可供数量」故意不叫「库存数量」——「库存」是现货状态的别名，会串列
GROUPS = [
    ('基本信息 / Informasi Dasar', [
        ('产品名称\nNama Produk',        True,  24, '产品的通用叫法，不含数量、单位、品牌。如「抛光瓷砖」「PVC 给水管」「镀锌自攻螺丝」', '抛光瓷砖'),
        ('品类\nKategori',               True,  13, '从下拉选一个大类（见「填写说明」页）', '装饰材料'),
        ('子类 / 用途\nSub-kategori',     False, 14, '更细的分类或用途，如「地砖」「墙砖」「PPR 热水管」', '地砖'),
        ('品牌\nMerek',                  False, 12, '产品品牌；自有品牌写自己的，无品牌写「无」', 'Roman'),
        ('型号\nModel / Tipe',           False, 14, '厂家型号或货号', 'RG6060'),
        ('规格参数\nSpesifikasi',         False, 24, '尺寸 / 功率 / 厚度 / 承重等关键参数，多项用「/」分隔', '600×600mm / 厚 9.5mm / 亮面'),
        ('材质\nMaterial',               False, 12, '主要材质，如 瓷质 / PVC / 304 不锈钢 / 镀锌钢 / 实木', '瓷质'),
        ('颜色\nWarna',                  False, 10, '可选颜色，多个用「/」分隔', '米白 / 浅灰'),
        ('计量单位\nSatuan',              True,  10, '报价对应的单位，从下拉选', '箱'),
    ]),
    ('价格与供应 / Harga & Pasokan', [
        ('供货价\nHarga (IDR)',          True,  15, '给星选的价格，印尼盾，未税，只填数字（如 185000），不加逗号、Rp、「万」', 185000),
        ('市场参考价\nHarga Pasar',       False, 15, '零售 / 市场常见价，印尼盾，选填，帮我们判断定价空间', 260000),
        ('起订量\nMOQ',                   False, 9,  '最少订多少个「计量单位」，不限填 1', 50),
        ('现货状态\nStok',                False, 11, '从下拉选', '有现货'),
        ('可供数量\nJumlah Tersedia',      False, 12, '当前可立即供应的数量（按计量单位）', 2000),
        ('交货周期\nWaktu Pengiriman',    False, 13, '下单到发货多久，如「现货当天」「3-5 天」「15 天」', '3-5 天'),
        ('运费说明\nOngkir',              False, 18, '含运 / 不含运 / 哪些区域包邮', '雅加达含运，外岛另计'),
    ]),
    ('物流与包装 / Logistik & Kemasan', [
        ('包装规格\nKemasan',             False, 16, '一个计量单位里装多少，如「4 片/箱」「50kg/袋」「100 个/包」', '4 片/箱（1.44 ㎡）'),
        ('单件重量\nBerat',               False, 12, '一个计量单位的毛重，带单位', '28 kg/箱'),
        ('单件尺寸\nDimensi',             False, 16, '一个计量单位的外包装长×宽×高，用于算物流', '62×62×10 cm'),
        ('产地\nAsal Produk',             False, 12, '生产地，国家或城市', 'Indonesia'),
    ]),
    ('资质与售后 / Sertifikasi & Layanan', [
        ('执行标准 / 认证\nSertifikasi',   False, 16, 'SNI / ISO / CE / CCC 等，多个用「/」分隔；有证书可另附', 'SNI'),
        ('质保期\nGaransi',               False, 10, '如「1 年」「3 年」，无则留空', '1 年'),
        ('售后服务\nLayanan Purna Jual',   False, 18, '退换 / 维修 / 技术支持等', '非人为损坏 30 天包换'),
    ]),
    ('图片与描述 / Gambar & Deskripsi', [
        ('图片链接\nLink Gambar',         False, 34, '产品图 URL，多张用英文逗号分隔；也可另发图片文件给对接人', 'https://example.com/a.jpg,https://example.com/b.jpg'),
        ('产品描述\nDeskripsi',           False, 34, '用途 / 优势 / 注意事项，供客户了解', '适用于客厅、卧室地面，耐磨防滑'),
    ]),
]
COLUMNS = [c for _g, cols in GROUPS for c in cols]

SUPPLIER_FIELDS = [
    ('公司名称 / Nama Perusahaan', '营业执照上的全称'),
    ('联系人 / Nama Kontak', ''),
    ('电话 / WhatsApp', '带国家区号，如 +62'),
    ('邮箱 / Email', ''),
    ('公司地址 / Alamat', ''),
    ('主营品类 / Kategori Utama', '如「装饰材料、卫浴照明」'),
    ('营业执照号 / NIB', ''),
    ('税号 / NPWP', '开票需要'),
    ('填表日期 / Tanggal', ''),
]

BLUE = '1D57E0'
FILL_TITLE = PatternFill('solid', fgColor=BLUE)
FILL_GROUP = PatternFill('solid', fgColor='E8EEFB')
FILL_HEAD = PatternFill('solid', fgColor='F2F4F7')
FILL_REQ = PatternFill('solid', fgColor='FDECEC')
FILL_EXAMPLE = PatternFill('solid', fgColor='FFFBEA')
FILL_LABEL = PatternFill('solid', fgColor='F5F7FA')
THIN = Side(style='thin', color='C9CFD8')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
F = lambda **kw: Font(name='Arial', **kw)  # noqa: E731


def sheet_products(ws):
    ws.title = '产品清单 Produk'
    n = len(COLUMNS)

    # 第 1 行：分组带（合并单元格）
    col = 1
    for gname, cols in GROUPS:
        c = ws.cell(row=1, column=col, value=gname)
        c.font = F(bold=True, size=10, color=BLUE)
        c.fill = FILL_GROUP
        c.alignment = Alignment(horizontal='center', vertical='center')
        c.border = BORDER
        if len(cols) > 1:
            ws.merge_cells(start_row=1, start_column=col, end_row=1, end_column=col + len(cols) - 1)
        for k in range(len(cols)):
            ws.cell(row=1, column=col + k).border = BORDER
        col += len(cols)
    ws.row_dimensions[1].height = 20

    # 第 2 行：表头（导入解析器认这一行 —— 见 _vendorXlsxRows：跳过没有「品名」的行）
    for i, (head, req, width, _h, _e) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=2, column=i, value=head + (' *' if req else ''))
        c.font = F(bold=True, size=10, color='B42318' if req else '1F2937')
        c.fill = FILL_REQ if req else FILL_HEAD
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = BORDER
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[2].height = 34

    # 第 3 行：示例（淡黄底，可删）
    for i, (_h, _r, _w, _hint, ex) in enumerate(COLUMNS, start=1):
        c = ws.cell(row=3, column=i, value=ex)
        c.fill = FILL_EXAMPLE
        c.font = F(size=10, italic=True, color='8A6D1E')
        c.alignment = Alignment(vertical='center', wrap_text=True)
        c.border = BORDER
    ws.cell(row=3, column=1).value = '（示例）抛光瓷砖'

    # 预留 300 行
    for r in range(4, 304):
        for i in range(1, n + 1):
            c = ws.cell(row=r, column=i)
            c.border = BORDER
            c.font = F(size=10)
            c.alignment = Alignment(vertical='center', wrap_text=True)

    heads = [c[0] for c in COLUMNS]

    def dropdown(title, options):
        idx = heads.index(title) + 1
        dv = DataValidation(type='list', formula1='"' + ','.join(options) + '"', allow_blank=True)
        dv.errorTitle = '请从下拉选择'
        dv.error = '这一列只能选下拉里的值'
        ws.add_data_validation(dv)
        L = get_column_letter(idx)
        dv.add(f'{L}3:{L}303')

    dropdown('品类\nKategori', CATEGORIES)
    dropdown('计量单位\nSatuan', UNITS)
    dropdown('现货状态\nStok', STOCK)

    for title, msg in [('供货价\nHarga (IDR)', '供货价只填数字，且大于 0'), ('市场参考价\nHarga Pasar', '只填数字')]:
        idx = heads.index(title) + 1
        dv = DataValidation(type='decimal', operator='greaterThan', formula1='0', allow_blank=True)
        dv.errorTitle = '无效数字'
        dv.error = msg
        ws.add_data_validation(dv)
        L = get_column_letter(idx)
        dv.add(f'{L}3:{L}303')

    ws.freeze_panes = 'B3'
    ws.auto_filter.ref = f'A2:{get_column_letter(n)}2'


def sheet_supplier(ws):
    ws.title = '供应商信息 Pemasok'
    ws.column_dimensions['A'].width = 30
    ws.column_dimensions['B'].width = 46
    ws.column_dimensions['C'].width = 28
    t = ws.cell(row=1, column=1, value='供应商信息 / Informasi Pemasok')
    t.font = F(bold=True, size=14, color='FFFFFF')
    t.fill = FILL_TITLE
    t.alignment = Alignment(vertical='center', indent=1)
    ws.merge_cells('A1:C1')
    ws.row_dimensions[1].height = 30
    ws.cell(row=2, column=1, value='每家供应商填一次即可 / Diisi sekali per pemasok').font = F(size=9, color='6B7280')
    ws.merge_cells('A2:C2')
    r = 4
    for label, hint in SUPPLIER_FIELDS:
        a = ws.cell(row=r, column=1, value=label)
        a.font = F(bold=True, size=10)
        a.fill = FILL_LABEL
        a.alignment = Alignment(vertical='center', indent=1)
        a.border = BORDER
        b = ws.cell(row=r, column=2)
        b.border = BORDER
        b.font = F(size=10)
        c = ws.cell(row=r, column=3, value=hint)
        c.font = F(size=9, color='9CA3AF', italic=True)
        c.alignment = Alignment(vertical='center')
        ws.row_dimensions[r].height = 24
        r += 1


def sheet_guide(ws):
    ws.title = '填写说明 Petunjuk'
    ws.column_dimensions['A'].width = 24
    ws.column_dimensions['B'].width = 92
    t = ws.cell(row=1, column=1, value='供应商产品信息收集表 · 填写说明')
    t.font = F(bold=True, size=14, color='FFFFFF')
    t.fill = FILL_TITLE
    t.alignment = Alignment(vertical='center', indent=1)
    ws.merge_cells('A1:B1')
    ws.row_dimensions[1].height = 30
    ws.cell(row=2, column=1, value='Formulir Pengumpulan Informasi Produk Pemasok · Petunjuk Pengisian').font = F(size=10, color='6B7280')
    ws.merge_cells('A2:B2')

    notes = [
        ('用途\nTujuan',
         '请在「产品清单」页逐行填写贵司可供应的产品，一行一个产品；「供应商信息」页填一次公司资料。\n'
         '填好后发给星选对接人，或登录供应商门户用「Excel 导入」自助上传。\n'
         'Isi produk satu baris satu produk di sheet「产品清单」; isi data perusahaan sekali di「供应商信息」. '
         'Kirim ke PIC Xingxuan atau unggah lewat portal pemasok.'),
        ('必填项\nWajib',
         '带 * 且红底的列必填：产品名称、品类、计量单位、供货价。缺任何一项该行不会被录入。\n'
         'Kolom bertanda * (latar merah) wajib: Nama Produk, Kategori, Satuan, Harga.'),
        ('价格口径\nHarga',
         '供货价 = 给星选的价格，印尼盾（IDR），未税，只填数字（如 185000）。不要加逗号、Rp 或「万」。\n'
         '市场参考价选填，是零售 / 市场常见价，帮我们判断定价空间。\n'
         'Harga adalah harga ke Xingxuan dalam IDR, belum termasuk pajak, angka saja.'),
        ('一行一品\nSatu baris satu produk',
         '同一产品不同规格 / 颜色（如 600×600 和 800×800）请分成两行填，不要写在一格里。\n'
         'Produk yang sama dengan spesifikasi / warna berbeda diisi di baris terpisah.'),
        ('表头别改\nJudul kolom',
         '请不要修改、删除或调换第 1、2 行的表头，系统按表头识别列。第 3 行示例可以删掉。\n'
         'Jangan mengubah / menghapus baris judul. Baris contoh (baris 3) boleh dihapus.'),
        ('图片\nGambar',
         '「图片链接」填公网可访问的 URL，多张用英文逗号分隔。没有链接的可以把图片文件单独发给对接人，文件名写产品名。\n'
         'Isi URL gambar yang dapat diakses publik; atau kirim file gambar ke PIC dengan nama produk sebagai nama file.'),
        ('资质证书\nSertifikat',
         '有 SNI / ISO 等证书的，在「执行标准 / 认证」列写明，证书扫描件可另附发给对接人。\n'
         'Jika ada sertifikat SNI / ISO, tulis di kolom sertifikasi; scan sertifikat dapat dikirim terpisah.'),
        ('品类清单\nDaftar Kategori', '　'.join(CATEGORIES)),
        ('计量单位\nSatuan', '　'.join(UNITS)),
        ('现货状态\nStok', '有现货 = 可立即发货　　需订货 = 下单后生产 / 调货　　可定制 = 按需求定做'),
    ]
    r = 4
    for k, v in notes:
        a = ws.cell(row=r, column=1, value=k)
        a.font = F(bold=True, size=10)
        a.fill = FILL_LABEL
        a.alignment = Alignment(vertical='top', wrap_text=True, indent=1)
        a.border = BORDER
        b = ws.cell(row=r, column=2, value=v)
        b.font = F(size=10)
        b.alignment = Alignment(vertical='top', wrap_text=True, indent=1)
        b.border = BORDER
        ws.row_dimensions[r].height = 16 * (v.count('\n') + 1) + 12
        r += 1

    r += 1
    h = ws.cell(row=r, column=1, value='各列说明 / Keterangan Setiap Kolom')
    h.font = F(bold=True, size=12, color=BLUE)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    r += 1
    for label, w in [('列名 / Kolom', 1), ('怎么填 / Cara mengisi', 2)]:
        c = ws.cell(row=r, column=w, value=label)
        c.font = F(bold=True, size=10, color='FFFFFF')
        c.fill = FILL_TITLE
        c.border = BORDER
    r += 1
    for gname, cols in GROUPS:
        g = ws.cell(row=r, column=1, value=gname)
        g.font = F(bold=True, size=10, color=BLUE)
        g.fill = FILL_GROUP
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        r += 1
        for head, req, _w, hint, _e in cols:
            a = ws.cell(row=r, column=1, value=head.replace('\n', ' / ') + (' *' if req else ''))
            a.font = F(size=10, bold=req, color='B42318' if req else '1F2937')
            a.alignment = Alignment(vertical='top', wrap_text=True, indent=1)
            a.border = BORDER
            b = ws.cell(row=r, column=2, value=hint)
            b.font = F(size=10)
            b.alignment = Alignment(vertical='top', wrap_text=True, indent=1)
            b.border = BORDER
            r += 1
    ws.freeze_panes = 'A4'


def main():
    wb = Workbook()
    sheet_products(wb.active)        # 第一页：导入解析器优先读，也是供应商主要填的页
    sheet_supplier(wb.create_sheet())
    sheet_guide(wb.create_sheet())
    wb.active = 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f'已生成 {OUT.relative_to(OUT.parents[3])}  {OUT.stat().st_size:,} 字节，产品清单 {len(COLUMNS)} 列，{len(GROUPS)} 组')


if __name__ == '__main__':
    main()
