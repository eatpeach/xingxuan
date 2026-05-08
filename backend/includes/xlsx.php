<?php
/**
 * 极简 xlsx 生成器（纯 PHP + ZipArchive，无 composer / 无 PhpSpreadsheet）
 * 仅供本项目询价模板导出用，不追求通用。
 *
 * 用法：
 *   $b = new XlsxBuilder('询价单');
 *   $b->mergeRange('A1:J1', '星选建材 询价单 INQ20260508001', XlsxBuilder::S_TITLE);
 *   $b->row(['序号', '产品名', ...], XlsxBuilder::S_HEADER);
 *   $b->row([1, '插座', ...], XlsxBuilder::S_DATA_LEFT);
 *   $b->setColWidths([6, 24, 18, 12, 8, 18, 18, 16, 12, 24]);
 *   $b->saveTo($tmpPath); // 或 $b->emit($filename);
 */
class XlsxBuilder
{
    // 样式索引（与 _styles() 输出顺序对应）
    public const S_DEFAULT = 0;
    public const S_TITLE = 1;        // 标题：18pt 加粗、白字、深蓝底、垂直水平居中
    public const S_META_K = 2;       // 元信息 key：浅灰底、加粗、右对齐
    public const S_META_V = 3;       // 元信息 value：左对齐、有边框
    public const S_HEADER = 4;       // 表头：白字、蓝底（#1d57e0）、居中加粗、有边框
    public const S_DATA_CENTER = 5;  // 数据单元：居中、有边框
    public const S_DATA_LEFT = 6;    // 数据单元：左对齐、有边框
    public const S_TOTAL = 7;        // 合计行：浅蓝底、加粗、居中
    public const S_NOTE = 8;         // 说明行：斜体灰

    private string $sheetName;
    /** @var array<int, array{cells: array<int, array{val: string|int|float, style: int, type: string}>, height?: float}> */
    private array $rows = [];
    /** @var array<int, float> */
    private array $colWidths = [];
    /** @var array<int, string> */
    private array $merges = [];
    private int $rowIdx = 0;

    public function __construct(string $sheetName = 'Sheet1')
    {
        // 表名不能含 / \ * ? : [ ] 且 <= 31 字符
        $safe = preg_replace('/[\\/\\\\*\\?\\:\\[\\]]/', '_', $sheetName);
        $this->sheetName = mb_substr((string) $safe, 0, 31);
    }

    public function setColWidths(array $widths): void
    {
        $this->colWidths = array_values($widths);
    }

    /** 推一行；$cells 可以是字符串/数字数组，或带 style 的 [ ['val'=>..,'style'=>..], ... ] */
    public function row(array $cells, int $style = self::S_DEFAULT, ?float $height = null): void
    {
        $this->rowIdx++;
        $r = ['cells' => []];
        if ($height !== null) $r['height'] = $height;
        foreach (array_values($cells) as $c) {
            if (is_array($c) && (array_key_exists('val', $c) || array_key_exists('style', $c))) {
                $val = $c['val'] ?? '';
                $st = $c['style'] ?? $style;
            } else {
                $val = $c;
                $st = $style;
            }
            $isNum = is_int($val) || is_float($val) || (is_string($val) && $val !== '' && is_numeric($val) && substr($val, 0, 1) !== '0');
            $r['cells'][] = [
                'val' => $val,
                'style' => $st,
                'type' => $isNum ? 'n' : 'inlineStr',
            ];
        }
        $this->rows[] = $r;
    }

    public function emptyRow(?float $height = null): void
    {
        $this->row([], self::S_DEFAULT, $height);
    }

    /**
     * 把 A1:J1 这种范围合并，并把内容写到左上角格子上。
     * 注意：此处假定该 range 所在行还没写过；它会推一行新行（占位 row 1 单元格 + 后续空白）。
     */
    public function mergeRange(string $range, $value, int $style = self::S_TITLE, ?float $height = null): void
    {
        // 解析 range，比如 A1:J1
        if (!preg_match('/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/', $range, $m)) {
            throw new InvalidArgumentException("非法 range: {$range}");
        }
        [$_, $colA, $rowA, $colB, $rowB] = $m;
        $colAIdx = self::colToIndex($colA);
        $colBIdx = self::colToIndex($colB);
        $width = $colBIdx - $colAIdx + 1;

        // 推一行包含 width 个单元格（首格有值，其余空但带样式以让合并视觉一致）
        $cells = [];
        $cells[] = ['val' => $value, 'style' => $style];
        for ($i = 1; $i < $width; $i++) {
            $cells[] = ['val' => '', 'style' => $style];
        }
        $this->row($cells, $style, $height);
        // 合并是按当前 rowIdx 来
        $this->merges[] = $colA . $this->rowIdx . ':' . $colB . $this->rowIdx;
    }

    /** 写到临时文件 */
    public function saveTo(string $path): void
    {
        $z = new ZipArchive();
        if ($z->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Cannot create xlsx zip');
        }
        $z->addFromString('[Content_Types].xml', self::contentTypes());
        $z->addFromString('_rels/.rels', self::rootRels());
        $z->addFromString('xl/workbook.xml', $this->workbookXml());
        $z->addFromString('xl/_rels/workbook.xml.rels', self::workbookRels());
        $z->addFromString('xl/styles.xml', self::stylesXml());
        $z->addFromString('xl/worksheets/sheet1.xml', $this->sheetXml());
        $z->close();
    }

    /** 直接以 attachment 形式输出到 stdout，附文件名 */
    public function emit(string $filename): void
    {
        $tmp = tempnam(sys_get_temp_dir(), 'xlsx_');
        $this->saveTo($tmp);

        if (function_exists('header_remove')) header_remove();
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
        header('Content-Length: ' . filesize($tmp));
        header('Cache-Control: no-cache, no-store, must-revalidate');
        readfile($tmp);
        @unlink($tmp);
    }

    // ---------------- 内部 ----------------

    private static function colToIndex(string $col): int
    {
        $col = strtoupper($col);
        $n = 0;
        $len = strlen($col);
        for ($i = 0; $i < $len; $i++) {
            $n = $n * 26 + (ord($col[$i]) - 64);
        }
        return $n;
    }

    private static function indexToCol(int $idx): string
    {
        $s = '';
        while ($idx > 0) {
            $r = ($idx - 1) % 26;
            $s = chr(65 + $r) . $s;
            $idx = (int) (($idx - 1) / 26);
        }
        return $s;
    }

    private static function xmlEscape($v): string
    {
        return htmlspecialchars((string) $v, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function workbookXml(): string
    {
        $name = self::xmlEscape($this->sheetName);
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="' . $name . '" sheetId="1" r:id="rId1"/></sheets>
</workbook>';
    }

    private static function contentTypes(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>';
    }

    private static function rootRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>';
    }

    private static function workbookRels(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>';
    }

    /**
     * 样式表。
     * 字体（fonts）顺序：0 普通、1 加粗、2 加粗白、3 斜体灰、4 标题（18pt 加粗白）
     * 填充（fills）顺序：0 none、1 gray125（必需）、2 标题深蓝、3 表头蓝、4 浅灰、5 浅蓝、6 极浅蓝
     * 边框（borders）顺序：0 无、1 全边框
     * cellXfs 顺序：见 const S_*
     */
    private static function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
  <font><sz val="11"/><name val="微软雅黑"/></font>
  <font><b/><sz val="11"/><name val="微软雅黑"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font>
  <font><i/><sz val="10"/><color rgb="FF8C8C8C"/><name val="微软雅黑"/></font>
  <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="微软雅黑"/></font>
</fonts>
<fills count="7">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0B3FB3"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1D57E0"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F5"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE6F0FF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFAFBFC"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color rgb="FFD9D9D9"/></left>
    <right style="thin"><color rgb="FFD9D9D9"/></right>
    <top style="thin"><color rgb="FFD9D9D9"/></top>
    <bottom style="thin"><color rgb="FFD9D9D9"/></bottom>
    <diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
  <!-- 0 default -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <!-- 1 title -->
  <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
    <alignment horizontal="center" vertical="center"/>
  </xf>
  <!-- 2 meta key -->
  <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="right" vertical="center"/>
  </xf>
  <!-- 3 meta value -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center" indent="1" wrapText="1"/>
  </xf>
  <!-- 4 header -->
  <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="center" vertical="center" wrapText="1"/>
  </xf>
  <!-- 5 data center -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
    <alignment horizontal="center" vertical="center" wrapText="1"/>
  </xf>
  <!-- 6 data left -->
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center" indent="1" wrapText="1"/>
  </xf>
  <!-- 7 total -->
  <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
    <alignment horizontal="center" vertical="center"/>
  </xf>
  <!-- 8 note -->
  <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">
    <alignment horizontal="left" vertical="center"/>
  </xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>';
    }

    private function sheetXml(): string
    {
        $cols = '';
        if ($this->colWidths) {
            $cols .= '<cols>';
            foreach ($this->colWidths as $i => $w) {
                $cols .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . $w . '" customWidth="1"/>';
            }
            $cols .= '</cols>';
        }

        $rowsXml = '<sheetData>';
        foreach ($this->rows as $rIdx0 => $row) {
            $rNum = $rIdx0 + 1;
            $hAttr = isset($row['height']) ? ' ht="' . $row['height'] . '" customHeight="1"' : '';
            $rowsXml .= '<row r="' . $rNum . '"' . $hAttr . '>';
            foreach ($row['cells'] as $cIdx0 => $cell) {
                $colLetter = self::indexToCol($cIdx0 + 1);
                $ref = $colLetter . $rNum;
                $val = $cell['val'];
                $st = $cell['style'];
                $type = $cell['type'];
                if ($val === '' || $val === null) {
                    // 空格仍输出，保留样式
                    $rowsXml .= '<c r="' . $ref . '" s="' . $st . '"/>';
                } elseif ($type === 'n') {
                    $rowsXml .= '<c r="' . $ref . '" s="' . $st . '"><v>' . $val . '</v></c>';
                } else {
                    $text = self::xmlEscape($val);
                    $rowsXml .= '<c r="' . $ref . '" s="' . $st . '" t="inlineStr"><is><t xml:space="preserve">' . $text . '</t></is></c>';
                }
            }
            $rowsXml .= '</row>';
        }
        $rowsXml .= '</sheetData>';

        $merges = '';
        if ($this->merges) {
            $merges .= '<mergeCells count="' . count($this->merges) . '">';
            foreach ($this->merges as $r) $merges .= '<mergeCell ref="' . $r . '"/>';
            $merges .= '</mergeCells>';
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>
<sheetFormatPr defaultRowHeight="20"/>
' . $cols . '
' . $rowsXml . '
' . $merges . '
</worksheet>';
    }
}
