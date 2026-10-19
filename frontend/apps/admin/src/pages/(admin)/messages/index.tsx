import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Pagination } from '@astryxdesign/core/Pagination';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import ActionDialog from '@/components/ActionDialog';
import MailHtmlPreview from '@/components/MailHtmlPreview';
import PageHeader from '@/components/PageHeader';
import { apiFetch, downloadTextFile, queryString } from '@/service/workbench';
import type { Account, MailMessage, Pagination as PageInfo } from '@/types/workbench';
import { formatShanghaiTime } from '@/utils/time';

interface SearchFilters {
  /** 空值表示全部账号。 */
  accountId: string;
  /** 在主题和正文中匹配的短语。 */
  keyword: string;
}
interface SearchMessage extends MailMessage {
  /** 邮件所属主账号。 */
  appleId?: string;
}
interface SearchResult {
  /** 当前页匹配邮件。 */
  messages: SearchMessage[];
  /** 全部匹配邮件的分页信息。 */
  pagination: PageInfo;
  /** 全部匹配邮件关联的去重邮箱数。 */
  mailboxCount: number;
}

const initialFilters: SearchFilters = { accountId: '', keyword: '' };

/** 在所有已同步邮件中搜索主题和正文，并批量复制或导出匹配结果。 */
const MessagesPage = () => {
  const toast = useToast();
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [textMode, setTextMode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const accountId = params.get('accountId') || '';
    const keyword = params.get('keyword') || '';
    if (accountId || keyword) {
      setDraft({ accountId, keyword });
      setFilters({ accountId, keyword });
    }
  }, []);

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: Account[] }>('/api/icloud-accounts')
  });
  const results = useQuery({
    queryKey: ['message-search', filters, page],
    queryFn: () => apiFetch<SearchResult>(`/api/messages/search?${queryString({ ...filters, page, pageSize: 20 })}`)
  });
  const detail = useQuery({
    enabled: Boolean(selectedId),
    queryKey: ['message', selectedId],
    queryFn: () => apiFetch<{ message: MailMessage }>(`/api/messages/${encodeURIComponent(selectedId)}`)
  });
  const message = detail.data?.message;
  const changed = draft.keyword.trim() !== filters.keyword || draft.accountId !== filters.accountId;
  const total = results.data?.pagination.total || 0;

  /** 应用输入条件；重复搜索时刷新当前匹配结果。 */
  function search() {
    const next = { ...draft, keyword: draft.keyword.trim() };
    if (next.keyword.length > 300) {
      toast({ body: '关键词最多 300 个字符', type: 'error' });
      return;
    }
    if (page === 1 && next.keyword === filters.keyword && next.accountId === filters.accountId) void results.refetch();
    setFilters(next);
    setPage(1);
  }

  /** 复制全部匹配邮箱或导出全文，始终使用已应用的筛选条件。 */
  async function batch(action: 'copy' | 'export') {
    setBusy(true);
    try {
      const params = queryString({ ...filters });
      if (action === 'export') {
        await downloadTextFile(`/api/messages/search/export?${params}`, {}, 'mail-search.csv');
        toast({ body: '已导出全部匹配邮件及正文' });
      } else {
        const data = await apiFetch<{ emails: string[] }>(`/api/messages/search/emails?${params}`);
        if (!data.emails.length) {
          toast({ body: '匹配邮件未关联隐藏邮箱，暂无可复制的地址', type: 'error' });
          return;
        }
        await navigator.clipboard.writeText(data.emails.join('\n'));
        toast({ body: `已复制 ${data.emails.length} 个去重邮箱` });
      }
    } catch (error) {
      toast({ body: error instanceof Error ? error.message : '操作失败，请重试', type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /** 展示单封邮件正文和读取失败状态。 */
  function renderDetail() {
    if (detail.isLoading) return <Spinner label="正在加载全文" />;
    if (detail.isError) return <Text>{detail.error.message}</Text>;
    if (!message) return <Text>邮件不存在</Text>;
    return (
      <VStack gap={3}>
        <Text weight="bold">{message.subject || '无主题'}</Text>
        <Text color="secondary">收件邮箱：{message.hiddenEmail || '未匹配隐私邮箱'}</Text>
        <Text color="secondary">{message.sender || '未知发件人'} · {formatShanghaiTime(message.receivedAt)}</Text>
        {message.bodyHtml ? (
          <Button label={textMode ? '显示 HTML 正文' : '显示纯文本'} onClick={() => setTextMode(!textMode)} />
        ) : null}
        {message.bodyHtml && !textMode ? (
          <MailHtmlPreview html={message.bodyHtml} title={message.subject || '邮件全文'} />
        ) : (
          <Text as="div" className="workbench-code workbench-mail-text">{message.bodyText || message.preview || '无纯文本正文'}</Text>
        )}
      </VStack>
    );
  }

  return (
    <Section className="workbench-page" padding={6}>
      <VStack gap={5}>
        <PageHeader title="邮件搜索" description="跨账号搜索已同步邮件的主题和正文，忽略大小写并合并空白。未同步的远端历史邮件不在搜索范围内。" />
        <HStack gap={3} vAlign="end" wrap="wrap">
          <Selector
            hasClear
            label="账号范围"
            options={(accounts.data?.accounts || []).map(item => ({ label: item.appleId, value: item.id }))}
            placeholder="全部账号"
            value={draft.accountId}
            onChange={accountId => setDraft(current => ({ ...current, accountId: accountId || '' }))}
          />
          <TextInput
            hasClear
            label="主题或正文关键词"
            placeholder="Your free month of ChatGPT Plus"
            value={draft.keyword}
            onChange={keyword => setDraft(current => ({ ...current, keyword: keyword || '' }))}
            onEnter={search}
          />
          <Button isLoading={results.isFetching} label="搜索" variant="primary" onClick={search} />
          <Button isDisabled={busy || changed || results.isFetching || !total} label="复制全部匹配邮箱" onClick={() => batch('copy')} />
          <Button isDisabled={busy || changed || results.isFetching || !total} isLoading={busy} label="导出全部匹配邮件" onClick={() => batch('export')} />
        </HStack>
        {accounts.isError ? <Text>账号列表加载失败：{accounts.error.message}</Text> : null}
        <Text color="secondary">
          {changed ? '筛选条件已修改，请点击搜索后再复制或导出。' : `共 ${total} 封匹配邮件，关联 ${results.data?.mailboxCount || 0} 个隐藏邮箱。复制自动去重，导出包含全部匹配正文。`}
        </Text>
        {results.isLoading ? <Spinner label="正在搜索邮件" /> : results.isError ? (
          <Text>搜索失败：{results.error.message}</Text>
        ) : !total ? (
          <EmptyState title="没有匹配邮件" description="可以缩短关键词，切换全部账号，或先在收件箱同步邮件。" />
        ) : (
          <VStack gap={3}>
            {results.data?.messages.map(item => (
              <Card key={item.id}>
                <VStack gap={2}>
                  <HStack hAlign="between" vAlign="center" wrap="wrap" gap={2}>
                    <Text weight="bold">{item.subject || '无主题'}</Text>
                    <Button label="查看全文" onClick={() => { setSelectedId(item.id); setTextMode(false); }} />
                  </HStack>
                  <Text color="secondary">收件邮箱：{item.hiddenEmail || '未匹配隐私邮箱'} · 所属账号：{item.appleId || '未知'}</Text>
                  <Text color="secondary">{item.sender || '未知发件人'} · {formatShanghaiTime(item.receivedAt)}</Text>
                  <Text as="div" className="workbench-mail-text">{item.preview || '无正文摘要'}</Text>
                </VStack>
              </Card>
            ))}
            <Pagination label="搜索结果分页" page={page} pageSize={20} totalItems={total} onChange={setPage} />
          </VStack>
        )}
      </VStack>
      <ActionDialog
        isOpen={Boolean(selectedId)}
        title="邮件全文"
        primaryLabel="关闭"
        width="min(960px, 94vw)"
        onOpenChange={open => { if (!open) setSelectedId(''); }}
        onPrimary={() => setSelectedId('')}
      >
        {renderDetail()}
      </ActionDialog>
    </Section>
  );
};

export const Route = createFileRoute('/(admin)/messages/')({
  component: MessagesPage,
  staticData: { title: '邮件搜索', menu: { icon: 'mdi:email-search', order: 6 } }
});
