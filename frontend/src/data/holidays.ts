/**
 * 中国 + 印尼 节假日（红日历）
 * 数据手工整理。中国为官方公历日期；印尼伊斯兰/印度教节日按当年阳历换算。
 * 维护方式：每年 12 月前更新一次。
 */

export type Holiday = {
  date: string // YYYY-MM-DD
  name: string
  country: 'CN' | 'ID'
}

export const HOLIDAYS: Holiday[] = [
  // ====== 2025 ======
  // 中国
  { date: '2025-01-01', name: '元旦', country: 'CN' },
  { date: '2025-01-28', name: '除夕', country: 'CN' },
  { date: '2025-01-29', name: '春节', country: 'CN' },
  { date: '2025-01-30', name: '春节', country: 'CN' },
  { date: '2025-01-31', name: '春节', country: 'CN' },
  { date: '2025-02-01', name: '春节', country: 'CN' },
  { date: '2025-02-02', name: '春节', country: 'CN' },
  { date: '2025-02-03', name: '春节', country: 'CN' },
  { date: '2025-02-04', name: '春节', country: 'CN' },
  { date: '2025-04-04', name: '清明节', country: 'CN' },
  { date: '2025-04-05', name: '清明节', country: 'CN' },
  { date: '2025-04-06', name: '清明节', country: 'CN' },
  { date: '2025-05-01', name: '劳动节', country: 'CN' },
  { date: '2025-05-02', name: '劳动节', country: 'CN' },
  { date: '2025-05-03', name: '劳动节', country: 'CN' },
  { date: '2025-05-04', name: '劳动节', country: 'CN' },
  { date: '2025-05-05', name: '劳动节', country: 'CN' },
  { date: '2025-05-31', name: '端午节', country: 'CN' },
  { date: '2025-06-01', name: '端午节', country: 'CN' },
  { date: '2025-06-02', name: '端午节', country: 'CN' },
  { date: '2025-10-01', name: '国庆节', country: 'CN' },
  { date: '2025-10-02', name: '国庆节', country: 'CN' },
  { date: '2025-10-03', name: '国庆节', country: 'CN' },
  { date: '2025-10-04', name: '国庆节', country: 'CN' },
  { date: '2025-10-05', name: '国庆节', country: 'CN' },
  { date: '2025-10-06', name: '中秋节', country: 'CN' },
  { date: '2025-10-07', name: '国庆节', country: 'CN' },
  { date: '2025-10-08', name: '国庆节', country: 'CN' },
  // 印尼 2025
  { date: '2025-01-01', name: 'Tahun Baru', country: 'ID' },
  { date: '2025-01-27', name: 'Isra Mikraj', country: 'ID' },
  { date: '2025-01-29', name: 'Tahun Baru Imlek', country: 'ID' },
  { date: '2025-03-29', name: 'Hari Suci Nyepi', country: 'ID' },
  { date: '2025-03-31', name: 'Idul Fitri', country: 'ID' },
  { date: '2025-04-01', name: 'Idul Fitri', country: 'ID' },
  { date: '2025-04-18', name: 'Jumat Agung', country: 'ID' },
  { date: '2025-04-20', name: 'Paskah', country: 'ID' },
  { date: '2025-05-01', name: 'Hari Buruh', country: 'ID' },
  { date: '2025-05-12', name: 'Hari Raya Waisak', country: 'ID' },
  { date: '2025-05-29', name: 'Kenaikan Isa Almasih', country: 'ID' },
  { date: '2025-06-01', name: 'Hari Lahir Pancasila', country: 'ID' },
  { date: '2025-06-06', name: 'Idul Adha', country: 'ID' },
  { date: '2025-06-27', name: 'Tahun Baru Islam', country: 'ID' },
  { date: '2025-08-17', name: 'Hari Kemerdekaan', country: 'ID' },
  { date: '2025-09-05', name: 'Maulid Nabi', country: 'ID' },
  { date: '2025-12-25', name: 'Hari Natal', country: 'ID' },

  // ====== 2026 ======
  // 中国
  { date: '2026-01-01', name: '元旦', country: 'CN' },
  { date: '2026-01-02', name: '元旦', country: 'CN' },
  { date: '2026-01-03', name: '元旦', country: 'CN' },
  { date: '2026-02-16', name: '除夕', country: 'CN' },
  { date: '2026-02-17', name: '春节', country: 'CN' },
  { date: '2026-02-18', name: '春节', country: 'CN' },
  { date: '2026-02-19', name: '春节', country: 'CN' },
  { date: '2026-02-20', name: '春节', country: 'CN' },
  { date: '2026-02-21', name: '春节', country: 'CN' },
  { date: '2026-02-22', name: '春节', country: 'CN' },
  { date: '2026-02-23', name: '春节', country: 'CN' },
  { date: '2026-02-24', name: '春节', country: 'CN' },
  { date: '2026-04-05', name: '清明节', country: 'CN' },
  { date: '2026-04-06', name: '清明节', country: 'CN' },
  { date: '2026-05-01', name: '劳动节', country: 'CN' },
  { date: '2026-05-02', name: '劳动节', country: 'CN' },
  { date: '2026-05-03', name: '劳动节', country: 'CN' },
  { date: '2026-05-04', name: '劳动节', country: 'CN' },
  { date: '2026-05-05', name: '劳动节', country: 'CN' },
  { date: '2026-06-19', name: '端午节', country: 'CN' },
  { date: '2026-06-20', name: '端午节', country: 'CN' },
  { date: '2026-06-21', name: '端午节', country: 'CN' },
  { date: '2026-09-25', name: '中秋节', country: 'CN' },
  { date: '2026-09-26', name: '中秋节', country: 'CN' },
  { date: '2026-09-27', name: '中秋节', country: 'CN' },
  { date: '2026-10-01', name: '国庆节', country: 'CN' },
  { date: '2026-10-02', name: '国庆节', country: 'CN' },
  { date: '2026-10-03', name: '国庆节', country: 'CN' },
  { date: '2026-10-04', name: '国庆节', country: 'CN' },
  { date: '2026-10-05', name: '国庆节', country: 'CN' },
  { date: '2026-10-06', name: '国庆节', country: 'CN' },
  { date: '2026-10-07', name: '国庆节', country: 'CN' },
  // 印尼 2026
  { date: '2026-01-01', name: 'Tahun Baru', country: 'ID' },
  { date: '2026-01-16', name: 'Isra Mikraj', country: 'ID' },
  { date: '2026-02-17', name: 'Tahun Baru Imlek', country: 'ID' },
  { date: '2026-03-19', name: 'Hari Suci Nyepi', country: 'ID' },
  { date: '2026-03-20', name: 'Idul Fitri', country: 'ID' },
  { date: '2026-03-21', name: 'Idul Fitri', country: 'ID' },
  { date: '2026-04-03', name: 'Jumat Agung', country: 'ID' },
  { date: '2026-04-05', name: 'Paskah', country: 'ID' },
  { date: '2026-05-01', name: 'Hari Buruh', country: 'ID' },
  { date: '2026-05-14', name: 'Kenaikan Isa Almasih', country: 'ID' },
  { date: '2026-05-21', name: 'Idul Adha', country: 'ID' },
  { date: '2026-05-31', name: 'Hari Raya Waisak', country: 'ID' },
  { date: '2026-06-01', name: 'Hari Lahir Pancasila', country: 'ID' },
  { date: '2026-06-17', name: 'Tahun Baru Islam', country: 'ID' },
  { date: '2026-08-17', name: 'Hari Kemerdekaan', country: 'ID' },
  { date: '2026-08-26', name: 'Maulid Nabi', country: 'ID' },
  { date: '2026-12-25', name: 'Hari Natal', country: 'ID' },

  // ====== 2027 ======
  // 中国（中国国务院通常 12 月前公布次年。2027 这里按惯例预估；正式发布后请更新）
  { date: '2027-01-01', name: '元旦', country: 'CN' },
  { date: '2027-02-05', name: '除夕', country: 'CN' },
  { date: '2027-02-06', name: '春节', country: 'CN' },
  { date: '2027-02-07', name: '春节', country: 'CN' },
  { date: '2027-02-08', name: '春节', country: 'CN' },
  { date: '2027-02-09', name: '春节', country: 'CN' },
  { date: '2027-02-10', name: '春节', country: 'CN' },
  { date: '2027-02-11', name: '春节', country: 'CN' },
  { date: '2027-02-12', name: '春节', country: 'CN' },
  { date: '2027-04-05', name: '清明节', country: 'CN' },
  { date: '2027-05-01', name: '劳动节', country: 'CN' },
  { date: '2027-06-09', name: '端午节', country: 'CN' },
  { date: '2027-09-15', name: '中秋节', country: 'CN' },
  { date: '2027-10-01', name: '国庆节', country: 'CN' },
  { date: '2027-10-02', name: '国庆节', country: 'CN' },
  { date: '2027-10-03', name: '国庆节', country: 'CN' },
  { date: '2027-10-04', name: '国庆节', country: 'CN' },
  { date: '2027-10-05', name: '国庆节', country: 'CN' },
  { date: '2027-10-06', name: '国庆节', country: 'CN' },
  { date: '2027-10-07', name: '国庆节', country: 'CN' },
  // 印尼 2027（预估，正式公告前为参考）
  { date: '2027-01-01', name: 'Tahun Baru', country: 'ID' },
  { date: '2027-02-06', name: 'Tahun Baru Imlek', country: 'ID' },
  { date: '2027-03-09', name: 'Idul Fitri', country: 'ID' },
  { date: '2027-03-10', name: 'Idul Fitri', country: 'ID' },
  { date: '2027-05-01', name: 'Hari Buruh', country: 'ID' },
  { date: '2027-05-10', name: 'Idul Adha', country: 'ID' },
  { date: '2027-06-01', name: 'Hari Lahir Pancasila', country: 'ID' },
  { date: '2027-08-17', name: 'Hari Kemerdekaan', country: 'ID' },
  { date: '2027-12-25', name: 'Hari Natal', country: 'ID' },
]

const _index: Record<string, Holiday[]> = {}
for (const h of HOLIDAYS) {
  if (!_index[h.date]) _index[h.date] = []
  _index[h.date].push(h)
}

export function getHolidays(date: string): Holiday[] {
  return _index[date] || []
}
