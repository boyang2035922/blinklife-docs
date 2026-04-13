import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  wikiSidebar: [
    'index',
    'contributing',
    {
      type: 'category',
      label: '产品流程',
      collapsed: false,
      link: { type: 'generated-index', title: '产品流程', description: '用户旅程和页面交互文档' },
      items: [
        'product/recording-flow',
        'product/playback-flow',
        'product/clipping-flow',
        'product/review-flow',
        'product/watch-to-review-mapping',
        'product/review-briefing',
      ],
    },
    {
      type: 'category',
      label: '工程架构',
      collapsed: false,
      link: { type: 'generated-index', title: '工程架构', description: '技术实现和协议规范文档' },
      items: [
        'engineering/architecture-overview',
        'engineering/timeline-model',
        'engineering/event-model',
        'engineering/blink-file-format',
        'engineering/clip-task-batch',
        'engineering/ffmpeg-pipeline',
        'engineering/ble-communication',
        'engineering/database-schema',
        'engineering/cloud-sync-architecture',
        'engineering/state-management',
        'engineering/review-dev-breakdown',
      ],
    },
    {
      type: 'category',
      label: '设计规范',
      collapsed: true,
      link: { type: 'generated-index', title: '设计规范', description: 'UI 组件和布局规范' },
      items: [
        'design/liquid-glass-spec',
        'design/immersive-detail-spec',
        'design/component-catalog',
      ],
    },
    {
      type: 'category',
      label: '数据定义',
      collapsed: true,
      link: { type: 'generated-index', title: '数据定义', description: '模型字典和 API 端点' },
      items: [
        'data/model-dictionary',
        'data/recording-data-format',
        'data/api-endpoints',
      ],
    },
    {
      type: 'category',
      label: '测试',
      collapsed: true,
      link: { type: 'generated-index', title: '测试', description: '测试策略和验收清单' },
      items: [
        'testing/test-focus-areas',
      ],
    },
  ],
};

export default sidebars;
