/**
 * 亚铝订货商城（畅捷通 T+ mshop）全量商品拉取 hook —— 在【已登录】的商城页面控制台里用（tasks/20260918-26）
 *
 * 原理：不逆向签名（host_key / aeskey 每请求不同），只被动截 XHR 响应：
 *   queryBaseInfos  → 商品基础信息（分页 20 条，含 imgUrl / specNo / 单位 / 起订倍数）
 *   queryDynamicInfo → 认证价 price / 零售价 retailPrice / 可供数量 / 已售罄（必须登录态，游客只有「认证可见」）
 * 页面自己翻页（滚到底触发下一页），hook 只收集。列表容器是 .am-list-view-scrollview，
 * 程序滚 scrollTop 不触发加载，需要真实滚轮事件（Claude 的 computer.scroll / 人手滚），
 * 所以是「滚一下 → step() 一下」的步进式，不是全自动。
 *
 * 用法：
 *   1. 登录商城，进任一分类列表页，把本文件整段贴进控制台回车（挂上 hook，自动跳到 CATS[0]）
 *   2. 反复：滚轮滚到底 → 控制台执行 __pull.step()；step() 发现本分类 hasMore=0 会自动跳下一分类，
 *      同一位置 4 次没进展也会跳（列表太短没触发翻页的分类要回头补一次）
 *   3. 随时 __pull.status() 看进度；__pull.save() 把精简后的数据镜像到 localStorage['__yalv_pull']（页面丢了还能找回）
 *   4. 全部 done 后 __pull.download() 下载 yalv_products.json（14 列定位数组，喂给
 *      scripts/data-fixes/import_yalv_products.php 或 scripts/yalv_to_xlsx.py）
 *
 * 🔴 登录 token 在 cookie / 埋点 URL 里，不要把控制台里的请求头贴到任何文件或任务单。
 */
(function () {
  if (window.__obs) return console.log('hook already installed');
  const CATS = [
    'DELIXI德力西', 'BOSI波斯工具', 'Bridge大桥焊材', 'Welding焊机及配件', 'Lifting吊具', 'Sabuk&Jaring安全带/网',
    'Webbing Sling吊带', 'Safety劳保产品', 'Mesin施工机械', '货架', '国内及本地采购', 'MCB人民电器开关',
    'Tangga铝合金爬梯', '脚手架', 'Alat survei测绘工具', 'Kawat Besi铁丝', 'Pompa奥利水泵', 'Lampu照明灯具',
    'Sanitary箭牌家居', 'Scaffolding扣件', 'Baut紧固件10月', 'Baut紧固件', 'Pengencang通丝', 'Plywwod建筑模板',
    '德高树脂瓦', '油漆化工类', '东成工具', 'Bahan Abrasif磨具', '钢丝软管', '托盘物流箱周转筐', '金桥焊材', 'SOMY水泵',
  ];
  const S = (window.__pull = {
    items: {}, order: [], dyn: {}, catOf: {}, reqs: { base: 0, dyn: 0 }, lastBase: null, errors: [],
    log: [], done: false, ci: 0, cats: CATS, stepN: 0, same: 0, lastKey: '', stuck: [],
  });

  // ---- 被动截 XHR ----
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const u = this.__u || '', xhr = this;
    const isBase = u.includes('queryBaseInfos'), isDyn = u.includes('queryDynamicInfo');
    if (isBase || isDyn) {
      let req = null; try { req = JSON.parse(body); } catch (e) {}
      xhr.addEventListener('load', function () {
        let resp = null; try { resp = JSON.parse(xhr.responseText); } catch (e) {}
        if (!resp || xhr.status !== 200) { S.errors.push({ u: u.slice(-30), status: xhr.status }); return; }
        const list = Array.isArray(resp.data) ? resp.data : [];
        if (isBase) {
          S.reqs.base++;
          const cv = (((req || {}).criteria || [])[0] || {}).values;
          const catPath = cv ? cv[0] : '';
          let added = 0;
          for (const it of list) if (!S.items[it.id]) { S.items[it.id] = it; S.order.push(it.id); S.catOf[it.id] = catPath; added++; }
          S.lastBase = { catPath, first: (req || {}).firstResult, n: list.length, hasMore: resp.hasMore, added, t: Date.now() };
        } else {
          S.reqs.dyn++;
          for (const d of list) S.dyn[d.productId] = d;
        }
      });
    }
    return XS.apply(this, arguments);
  };
  window.__obs = true;

  S.route = (c) => '#/categorysearchresult?searchKey=' + encodeURIComponent(JSON.stringify({ name: '', treePath: c + '^' }));

  // 14 列定位数组（列序改了要同步 import_yalv_products.php / yalv_to_xlsx.py）
  S.compact = () => S.order.map((id) => {
    const it = S.items[id], d = S.dyn[id] || {}, du = (d.displayUoms && d.displayUoms[0]) || {};
    return [
      it.id, it.code || '', it.name || '', it.specNo || '', it.productBrandName || '', it.imgUrl || '',
      (it.salesUom && it.salesUom.uomName) || (it.baseUom && it.baseUom.uomName) || '',
      it.customized3075028658817976 == null ? '' : it.customized3075028658817976,   // 数量倍数 = 起订倍数
      (S.catOf[id] || '').replace(/\^$/, ''),
      du.price == null ? '' : du.price,             // 认证价（供货价）
      du.retailPrice == null ? '' : du.retailPrice, // 零售价
      d.availQty == null ? '' : d.availQty,
      d.isSoldOut ? 1 : 0,
      it.displayDescription || '',                  // 英文名
    ];
  });

  S.step = () => {
    S.stepN++;
    if (S.done) return 'done';
    const cur = S.cats[S.ci], lb = S.lastBase;
    const el = document.querySelector('.am-list-view-scrollview');
    const key = cur + ':' + (lb && lb.catPath === cur + '^' ? lb.first : '-');
    if (key === S.lastKey) S.same++; else { S.same = 0; S.lastKey = key; }
    const finished = lb && lb.catPath === cur + '^' && (lb.hasMore === 0 || lb.hasMore === false);
    if (finished || S.same >= 4) {
      if (!finished) S.stuck.push(key);
      S.log.push({ c: cur, items: Object.keys(S.items).length, stuck: !finished });
      S.ci++; S.same = 0; S.lastKey = '';
      if (S.ci < S.cats.length) { location.hash = S.route(S.cats[S.ci]); return 'next:' + S.cats[S.ci]; }
      S.done = true; return 'done';
    }
    if (el) el.scrollTop = el.scrollHeight;
    return 'scroll:' + cur + ':' + (lb && lb.first);
  };

  S.status = () => ({
    ci: S.ci, cat: S.cats[S.ci], items: Object.keys(S.items).length, dyn: Object.keys(S.dyn).length,
    first: S.lastBase && S.lastBase.first, hasMore: S.lastBase && S.lastBase.hasMore,
    reqs: S.reqs, errors: S.errors.length, done: S.done, stuck: S.stuck, log: S.log.slice(-3),
  });

  // 镜像到 localStorage（合并已有的，按商城 id 去重），返回总条数
  S.save = () => {
    let old = []; try { old = JSON.parse(localStorage.getItem('__yalv_pull') || '[]'); } catch (e) {}
    const have = new Set(old.map((r) => r[0]));
    for (const r of S.compact()) if (!have.has(r[0])) { old.push(r); have.add(r[0]); }
    localStorage.setItem('__yalv_pull', JSON.stringify(old));
    return old.length;
  };

  S.download = (name = 'yalv_products.json') => {
    S.save();
    const blob = new Blob([localStorage.getItem('__yalv_pull')], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  };

  location.hash = S.route(S.cats[0]);
  console.log('hook installed → 滚到底后执行 __pull.step()；__pull.status() 看进度');
})();
