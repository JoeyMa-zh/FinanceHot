// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（解读、观点）：日报写过的事又有评论类的跟进，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "macro", label: "宏观", feedLabel: "宏观经济", section: "宏观与央行", guide: "宏观经济与财政：增长、就业、通胀、消费、房地产、政府预算、债务与债务上限等已公布的数据和已发生的事件。数据公布前的预期、前瞻或调查归宏观；数据或政策引起的行情波动同时打上市场行情类标签，但主归类仍按信息本身。" },
  { key: "central-bank", label: "央行", feedLabel: "央行政策", section: "宏观与央行", guide: "美联储及其他主要央行的政策行动与官方沟通：利率决议、政策声明、点阵图、经济预测、会议纪要、缩表扩表安排、褐皮书，以及官员在国会政策场合的正式证词。官员个人演讲、访谈和未署名的放风不在此类，按内容归宏观或观点。" },
  { key: "equities", label: "股市", section: "市场与资产", guide: "股票市场整体：指数与板块的涨跌、成交量与波动率、资金流向、IPO 与上市规则、市场结构变化。单家公司的自身经营归公司或财报，不因其股价波动归入股市；盘中点位的例行播报不是市场事件。" },
  { key: "bonds", label: "债券利率", feedLabel: "债券与利率", section: "市场与资产", guide: "国债与信用债：收益率变化、拍卖、利差、评级调整、发行与违约，以及利率市场的定价变化。央行决议本身归央行；决议落地后市场利率与债券价格的走势归债券利率。" },
  { key: "fx", label: "外汇", feedLabel: "外汇", section: "市场与资产", guide: "汇率：美元及主要货币的走势、官方干预、外汇储备与结算安排。汇率背后的宏观数据或央行政策仍以宏观或央行为主归类；纯货币对行情与干预归外汇。" },
  { key: "commodities", label: "商品", feedLabel: "大宗商品", section: "市场与资产", guide: "大宗商品：黄金、原油、铜、农产品等的价格、供需、库存与运输变化。产地的地缘冲突若以影响市场供给为主归商品，以冲突和伤亡本身为主归风险事件。" },
  { key: "earnings", label: "财报", section: "公司与财报", guide: "上市公司已发布的财报、业绩指引、分红回购、拆股和业绩说明会。财报前的预期与评级调整归公司；只有口号的发布预告不是财报；财报引起的股价与板块波动同时打市场行情标签。" },
  { key: "industry", label: "公司", feedLabel: "公司动态", section: "公司与财报", guide: "已发生的公司经营动作：并购、融资、人事、产品与业务变化、产能与供应链、劳资、诉讼、真实安全事故及调查进展。新闻由当事人发帖、带有态度，也不因此变成观点。战略预告和没有交易实质的市场传闻按可信度低处理。" },
  { key: "regulation", label: "监管", feedLabel: "金融监管", section: "监管与风险", guide: "金融监管与政策：证券发行与交易、信息披露、反垄断、税收、行业准入等已公布的法规、执法行动和正式立案调查。政治人物的口头表态和未落地的提案归宏观或观点；监管落地后的市场反应同时打市场行情标签。" },
  { key: "risk-events", label: "风险事件", section: "监管与风险", guide: "冲击市场的突发事件及处置：地缘冲突、信用违约、金融机构倒闭或救助、市场操纵与闪崩、交易所技术故障、自然灾害。后续调查、赔付与整改进展也算；已消化的旧闻的例行周年回顾不算。" },
  { key: "opinion", label: "观点", section: "观点评论", guide: "重点是作者的解释、判断、预测、持仓观点或访谈观点，包括机构策略报告里先于事实的观点部分。讨论市场不自动归股市，作者是名人不自动归观点。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类官方发布（金融行业是央行政策行动）：日报报头的“N 项央行决议”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "central-bank", tag: "央行政策", unit: "项央行决议" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["fed", "fomc", "cpi", "ppi", "gdp", "pmi", "etf", "ipo", "vix", "eps", "nasdaq", "qqq"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["macro_data", "central_bank_action", "market_move", "earnings_report", "corporate_event", "policy_regulation", "risk_event", "opinion_analysis", "research_report"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "宏观数据", "央行政策", "市场行情", "债券/利率", "外汇", "大宗商品", "公司财报", "公司动态", "政策/监管", "风险事件", "市场观点", "研究/研报",
  "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "利率", "通胀", "就业", "国债", "美元", "黄金", "原油", "科技股", "地缘政治", "市场风险", "波动率", "IPO", "ETF资金流",
] as const;

/** 可选的实体标签（公司、机构、指数产品）。 */
export const ENTITY_TAGS = ["美联储", "纳斯达克", "QQQ", "苹果", "微软", "英伟达", "特斯拉", "亚马逊", "谷歌", "Meta", "博通"] as const;

/** 模型常写的近义词，统一成词表里的写法。注意：不要把 TOPIC_TAGS 里的词映射走（利率、美元、黄金、原油、就业、地缘政治等要保留为主题标签）。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "议息": "央行政策", "加息": "央行政策", "降息": "央行政策", "利率决议": "央行政策", "货币政策": "央行政策", "美联储决议": "央行政策", "qe": "央行政策", "量化宽松": "央行政策", "缩表": "央行政策",
  "非农": "宏观数据", "就业数据": "宏观数据", "经济数据": "宏观数据", "cpi": "宏观数据", "通胀数据": "宏观数据", "gdp": "宏观数据", 宏观: "宏观数据", 经济: "宏观数据", 数据: "宏观数据", 财政: "宏观数据",
  "大盘": "市场行情", 股市: "市场行情", 股票: "市场行情", 指数: "市场行情", 美股: "市场行情", 涨跌: "市场行情", "资金流向": "市场行情", 板块: "市场行情",
  "美债": "债券/利率", 国债: "债券/利率", 收益率: "债券/利率", 信用债: "债券/利率", 评级: "债券/利率", 债券: "债券/利率",
  汇率: "外汇", 外汇: "外汇", 美元指数: "外汇", 货币: "外汇",
  石油: "大宗商品", 铜价: "大宗商品", 商品: "大宗商品", 贵金属: "大宗商品",
  财报: "公司财报", 业绩: "公司财报", 指引: "公司财报", "财报季": "公司财报", 盈利: "公司财报", 分红: "公司财报", 回购: "公司财报",
  并购: "公司动态", 收购: "公司动态", 融资: "公司动态", 人事: "公司动态", 罢工: "公司动态", 诉讼: "公司动态", 公司动态: "公司动态", 企业: "公司动态", 供应链: "公司动态",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 执法: "政策/监管", 立法: "政策/监管", 反垄断: "政策/监管", "sec": "政策/监管",
  地缘: "风险事件", 黑天鹅: "风险事件", 避险: "风险事件", 违约: "风险事件", 倒闭: "风险事件", 闪崩: "风险事件", "风险事件": "风险事件", 突发: "风险事件",
  观点: "市场观点", 评论: "市场观点", 预测: "市场观点", 策略: "市场观点", 看多: "市场观点", 看空: "市场观点", "观点分析": "市场观点",
  论文: "研究/研报", 研究: "研究/研报", 研报: "研究/研报", paper: "研究/研报", papers: "研究/研报",
  波动: "波动率", vix: "波动率", "恐慌指数": "波动率",
  ipo: "IPO", 上市: "IPO", 退市: "IPO",
  etf: "ETF资金流", "资金流": "ETF资金流", 申赎: "ETF资金流",
  "科技股": "科技股", "七巨头": "科技股", "magnificent seven": "科技股", "mag7": "科技股",
  "失业率": "就业",
  其他: "其他", misc: "其他",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是公司自己的其他称呼（官方账号名、子品牌、产品线），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  fed: { name: "美联储", displayTag: "美联储", aliases: ["美联储", "Federal Reserve", "Fed", "FOMC", "联邦储备系统", "联储"], otherNames: ["Federal Open Market Committee", "Federal Reserve Board", "FOMC"] },
  nasdaq: { name: "纳斯达克", displayTag: "纳斯达克", aliases: ["纳斯达克", "Nasdaq", "纳指", "Nasdaq Composite", "Nasdaq-100", "NDX"], otherNames: ["Nasdaq Inc"] },
  qqq: { name: "QQQ", displayTag: "QQQ", aliases: ["QQQ", "Invesco QQQ", "纳指ETF"], otherNames: ["Invesco QQQ Trust", "QQQ Trust"] },
  apple: { name: "苹果", displayTag: "苹果", aliases: ["苹果", "Apple", "AAPL"], otherNames: ["iPhone", "iPad", "Mac", "Apple Watch", "App Store", "Apple Silicon"] },
  microsoft: { name: "微软", displayTag: "微软", aliases: ["微软", "Microsoft", "MSFT"], otherNames: ["Windows", "Azure", "Xbox", "LinkedIn", "GitHub"] },
  nvidia: { name: "英伟达", displayTag: "英伟达", aliases: ["英伟达", "NVIDIA", "NVDA"], otherNames: ["GeForce", "CUDA", "Blackwell"] },
  tesla: { name: "特斯拉", displayTag: "特斯拉", aliases: ["特斯拉", "Tesla", "TSLA"] },
  amazon: { name: "亚马逊", displayTag: "亚马逊", aliases: ["亚马逊", "Amazon", "AMZN"], otherNames: ["AWS", "Amazon Web Services", "Prime"] },
  alphabet: { name: "谷歌", displayTag: "谷歌", aliases: ["谷歌", "Google", "Alphabet", "GOOGL", "GOOG"], otherNames: ["YouTube", "Android", "Google Cloud", "DeepMind", "Waymo"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "META", "Facebook", "脸书"], otherNames: ["Instagram", "WhatsApp", "Threads", "Meta Platforms"] },
  broadcom: { name: "博通", displayTag: "博通", aliases: ["博通", "Broadcom", "AVGO"], otherNames: ["VMware"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "fed", name: "美联储", patterns: [/federal reserve|\bfomc\b|美联储|联邦储备|联储/i, /\bthe fed\b|\bfed's\b|鲍威尔|\bpowell\b|点阵图|\bdot plot\b/i] },
  { id: "nasdaq", name: "纳斯达克", patterns: [/nasdaq|纳斯达克|纳指|\bNDX\b|\bIXIC\b/i] },
  { id: "qqq", name: "QQQ", patterns: [/\bQQQ\b|Invesco QQQ|纳指ETF|纳斯达克100ETF/i] },
  { id: "apple", name: "苹果", patterns: [/\bapple\b|苹果|\bAAPL\b|iphone|ipad|\bapp store\b/i] },
  { id: "microsoft", name: "微软", patterns: [/microsoft|微软|\bMSFT\b|\bazure\b|windows\b/i] },
  { id: "nvidia", name: "英伟达", patterns: [/nvidia|英伟达|\bNVDA\b|\bGeForce\b|\bCUDA\b|\bBlackwell\b/i] },
  { id: "tesla", name: "特斯拉", patterns: [/tesla|特斯拉|\bTSLA\b|\bcybertruck\b/i] },
  { id: "amazon", name: "亚马逊", patterns: [/amazon|亚马逊|\bAMZN\b|\bAWS\b/i] },
  { id: "alphabet", name: "谷歌", patterns: [/alphabet|谷歌|google|\bGOOGL\b|\bGOOG\b|youtube|android/i] },
  { id: "meta", name: "Meta", patterns: [/\bMeta\b/, /\bmeta\s?platforms\b|facebook|instagram|whatsapp|threads/i] },
  { id: "broadcom", name: "博通", patterns: [/broadcom|博通|\bAVGO\b|\bVMware\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "fed", domains: ["federalreserve.gov"] },
  { entityId: "nasdaq", domains: ["nasdaq.com"] },
  { entityId: "apple", domains: ["apple.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "tesla", domains: ["tesla.com"] },
  { entityId: "amazon", domains: ["amazon.com", "aboutamazon.com"] },
  { entityId: "alphabet", domains: ["abc.xyz", "blog.google"] },
  { entityId: "meta", domains: ["meta.com", "about.fb.com"] },
  { entityId: "broadcom", domains: ["broadcom.com"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "fed", pattern: /美联储官员|\bFed officials\b/i },
];
