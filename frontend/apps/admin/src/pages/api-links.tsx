import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Section } from '@astryxdesign/core/Section';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Table, type TableColumn, pixel, proportional } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useToast } from '@astryxdesign/core/Toast';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { buildBuyerLinks, parseBuyerMailboxes } from '../features/public-mail/public-mail-utils';

type OutputMode = 'api' | 'both' | 'viewer';

interface LinkRow extends Record<string, unknown> {
  apiUrl: string;
  email: string;
  mode: string;
  viewerUrl: string;
}

const sample = `sixties_plenums4o@icloud.com----hIlenuHDJyjJWr\ndairies-brained.4e@icloud.com----dnPgFZWGxTK7T2G`;

/** 公开给买家的 API 取件链接生成工作台。 */
export const ApiLinksPage = () => {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<OutputMode>('api');
  const [limit, setLimit] = useState(15);
  const mailboxes = useMemo(() => parseBuyerMailboxes(input), [input]);
  const rows = useMemo<LinkRow[]>(
    () =>
      mailboxes.map(mailbox => {
        const links = buildBuyerLinks(mailbox, limit);
        return {
          apiUrl: links.apiUrl,
          email: mailbox.email,
          mode: mode === 'api' ? 'JSON 数据' : mode === 'viewer' ? '网页查看' : '网页 + JSON',
          viewerUrl: links.viewerUrl
        };
      }),
    [limit, mailboxes, mode]
  );

  function lineFor(row: LinkRow) {
    if (mode === 'api') return row.apiUrl;
    if (mode === 'viewer') return row.viewerUrl;
    return `${row.viewerUrl}\n${row.apiUrl}`;
  }

  async function copyAll() {
    await navigator.clipboard.writeText(rows.map(lineFor).join('\n'));
    toast({ body: `已复制 ${rows.length} 条链接` });
  }

  function exportTxt() {
    const blob = new Blob([`\uFEFF${rows.map(lineFor).join('\r\n')}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mode === 'api' ? 'buyer-json-links.txt' : mode === 'viewer' ? 'buyer-web-links.txt' : 'buyer-mail-links.txt';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const columns: TableColumn<LinkRow>[] = [
    { key: 'email', header: '邮箱', width: proportional(1.4), renderCell: row => <Text weight="bold">{row.email}</Text> },
    { key: 'mode', header: '方式', width: pixel(120), renderCell: row => <Badge label={String(row.mode)} variant="green" /> },
    {
      key: 'link',
      header: '链接',
      width: proportional(2),
      renderCell: row => (
        <Text className="workbench-code">{lineFor(row)}</Text>
      )
    }
  ];

  return (
    <Section className="public-console" padding={0}>
      <header className="public-console-header">
        <Button label="收件工作台" onClick={() => window.location.assign('/pickup')} />
        <div>
          <Heading level={2}>取件链接</Heading>
          <Text color="secondary">Developer Access</Text>
        </div>
      </header>
      <main className="public-api-grid">
        <Card>
          <VStack gap={5}>
            <VStack gap={1}>
              <Heading level={2}>批量生成</Heading>
              <Text color="secondary">粘贴邮箱账号，选择输出方式后生成链接。</Text>
            </VStack>
            <TextArea
              isLabelHidden
              label="邮箱账号"
              placeholder={sample}
              rows={14}
              value={input}
              onChange={setInput}
            />
            <HStack gap={4} wrap="wrap">
              <NumberInput label="返回封数" maxValue={50} minValue={1} value={limit} onChange={value => setLimit(Number(value || 15))} />
              <SegmentedControl label="输出方式" value={mode} onChange={value => setMode(value as OutputMode)}>
                <SegmentedControlItem label="网页查看" value="viewer" />
                <SegmentedControlItem label="JSON 数据" value="api" />
                <SegmentedControlItem label="两种链接" value="both" />
              </SegmentedControl>
            </HStack>
            <HStack gap={2}>
              <Button isDisabled={!rows.length} label="复制全部" variant="primary" onClick={copyAll} />
              <Button isDisabled={!rows.length} label="导出 TXT" onClick={exportTxt} />
              <Button label="清空" onClick={() => setInput('')} />
            </HStack>
          </VStack>
        </Card>
        <Card>
          <VStack gap={4}>
            <VStack gap={1}>
              <Heading level={3}>生成结果</Heading>
              <Text color="secondary">有效 {rows.length} 条，异常 0 行。</Text>
            </VStack>
            <div className="workbench-table-scroll">
              <Table<LinkRow> columns={columns} data={rows} density="compact" dividers="rows" hasHover idKey="email" />
            </div>
          </VStack>
        </Card>
      </main>
    </Section>
  );
};

export const Route = createFileRoute('/api-links')({
  component: ApiLinksPage,
  staticData: { title: 'API 取件链接' }
});
