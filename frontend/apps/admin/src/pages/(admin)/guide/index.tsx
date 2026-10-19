import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import PageHeader from '@/components/PageHeader';

const steps = [
  {
    title: '登录 iCloud',
    text: '打开 iCloud+，登录 Apple ID 并进入隐藏邮件地址。',
    copy: 'https://www.icloud.com/icloudplus/'
  },
  { title: '定位请求', text: '按 F12 打开 Network，勾选 Preserve log，过滤 maildomainws。', copy: 'maildomainws' },
  { title: '复制并导入', text: '右键 /v2/hme/list 或 /v1/hme/ 请求，选择 Copy as cURL。' }
];

/** 渲染 CK 获取步骤和复制按钮。 */
const GuidePage = () => {
  const navigate = useNavigate();
  const toast = useToast();

  /** 复制指南中的地址或筛选词。 */
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast({ body: '已复制' });
  }

  return (
    <Section className="workbench-page" padding={6}>
      <VStack gap={6}>
        <PageHeader description="从浏览器开发者工具复制完整隐藏邮箱请求。" title="iCloud CK 获取指南" />
        <Grid columns={{ minWidth: 280, repeat: 'fit' }} gap={4}>
          {steps.map((item, index) => (
            <Card key={item.title} minHeight={240}>
              <VStack gap={4}>
                <Badge label={`步骤 ${index + 1}`} variant="blue" />
                <Heading level={3}>{item.title}</Heading>
                <Text color="secondary">{item.text}</Text>
                {item.copy ? (
                  <Button label={`复制 ${item.copy}`} onClick={() => copy(item.copy!)} />
                ) : (
                  <Button label="前往 CK 账号" variant="primary" onClick={() => navigate({ to: '/accounts' })} />
                )}
              </VStack>
            </Card>
          ))}
        </Grid>
      </VStack>
    </Section>
  );
};

export const Route = createFileRoute('/(admin)/guide/')({
  component: GuidePage,
  staticData: { title: 'CK 获取指南', menu: { icon: 'mdi:book-open-page-variant', order: 7 } }
});
