export interface GalLink {
  id: string
  name: string
  url: string
  icon: string
  description: string
  tags: string[]
}

export const galLinks: GalLink[] = [
  {
    id: 'touchgal',
    name: 'TouchGal',
    url: 'https://www.touchgal.ink/',
    icon: '/icons/gal/touchgal.png',
    description: '一站式 Galgame 文化社区，作品资料、讨论与同好交流。',
    tags: ['社区', '资料']
  },
  {
    id: 'inarigal',
    name: '稻荷GAL',
    url: 'https://inarigal.com/',
    icon: '/icons/gal/inarigal.png',
    description: '温馨的视觉小说分享社区，游戏、汉化补丁与音乐资源。',
    tags: ['社区', '视觉小说']
  },
  {
    id: 'sakugal',
    name: 'SakuGAL',
    url: 'https://sakugal.com/',
    icon: '/icons/gal/sakugal.png',
    description: '免费视觉小说资源分享，珍惜每一段恋之故事。',
    tags: ['视觉小说', '资源']
  },
  {
    id: 'kisugal',
    name: 'KisuGal',
    url: 'https://kisugal.icu/',
    icon: '/icons/gal/kisugal.svg',
    description: '面向视觉小说玩家的长期资源站，强调文件稳定与可用。',
    tags: ['视觉小说', '下载']
  },
  {
    id: 'qimeng',
    name: '绮梦ACG',
    url: 'https://game.acgs.one/',
    icon: '/icons/gal/qimeng.png',
    description: '以视觉小说为核心，同时整理 ACG 相关内容。',
    tags: ['视觉小说', 'ACG']
  },
  {
    id: 'acgngame',
    name: 'ACGNGAME / Galworld',
    url: 'https://acgn.games/',
    icon: '/icons/gal/acgngame.svg',
    description: 'Galworld 视觉小说下载站，覆盖汉化与部分原版资源。',
    tags: ['Galgame', '汉化']
  },
  {
    id: 'nyantaku',
    name: '喵源领域',
    url: 'https://www.nyantaku.com/',
    icon: '/icons/gal/nyantaku.png',
    description: '围绕视觉小说本体与相关内容进行整理与分享。',
    tags: ['视觉小说', '整理']
  },
  {
    id: 'baiwan',
    name: '白万ACG',
    url: 'https://www.baiwanacg.top/',
    icon: '/icons/gal/baiwan.png',
    description: '全汉化、全语音、动态 CG 的二次元游戏资源站。',
    tags: ['Galgame', '汉化']
  },
  {
    id: 'acgws',
    name: 'ACG万事屋',
    url: 'https://acgws.com/',
    icon: '/icons/gal/acgws.svg',
    description: '精选视觉小说与剧情游戏，日系 PC/RPG 资源较多。',
    tags: ['视觉小说', '剧情']
  },
  {
    id: 'yinghua',
    name: '樱花ACG资源网',
    url: 'https://www.acgyhw.com/',
    icon: '/icons/gal/yinghua.jpg',
    description: '覆盖 SLG、ACT、RPG、ADV 等类型的综合 ACG 资源站。',
    tags: ['ACG', '综合']
  },
  {
    id: 'tuki',
    name: '朗月天明',
    url: 'https://tuki.top/',
    icon: '/icons/gal/tuki.svg',
    description: '偏 KRKR 与 ONS 模拟器的小众视觉小说资源站。',
    tags: ['KRKR', 'ONS']
  }
]
