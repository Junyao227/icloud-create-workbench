import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useToast } from '@astryxdesign/core/Toast';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import MailHtmlPreview from '@/components/MailHtmlPreview';
import type { MailMessage } from '@/types/workbench';
import { formatShanghaiTime } from '@/utils/time';

import {
  type BuyerMailbox,
  type BuyerMailResult,
  buildBuyerLinks,
  normalizeFeedData,
  parseBuyerMailboxes
} from '../features/public-mail/public-mail-utils';

const sample = `name@icloud.com----取件码\nother@icloud.com----取件码`;
const autoRefreshMs = 15_000;
const pickupStorageKey = 'icloud-pickup-mailbox-input-v1';

function readStoredPickupInput() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(pickupStorageKey) || '';
  } catch {
    return '';
  }
}

function saveStoredPickupInput(value: string) {
  if (typeof window === 'undefined') return;
  try {
    const next = value.trim();
    if (next) window.localStorage.setItem(pickupStorageKey, next);
    else window.localStorage.removeItem(pickupStorageKey);
  } catch {
    // localStorage may be disabled; pickup still works for the current page session.
  }
}

/** 公开给买家的批量收件工作台。 */
const PickupPage = () => {
  const toast = useToast();
  const [input, setInput] = useState(() => readStoredPickupInput());
  const [importedMailboxes, setImportedMailboxes] = useState<BuyerMailbox[]>([]);
  const [results, setResults] = useState<BuyerMailResult[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState('');
  const loadingRef = useRef(false);
  const restoredRef = useRef(false);
  const selectedEmailRef = useRef('');
  const selectedMessageIdRef = useRef('');
  const mailboxes = useMemo(() => parseBuyerMailboxes(input), [input]);
  const selectedResult = results.find(item => item.email === selectedEmail) || results[0];
  const selectedMessage =
    selectedResult?.messages.find(item => item.id === selectedMessageId) || selectedResult?.messages[0] || null;
  const isInitialLoading = loading && !selectedResult;

  useEffect(() => {
    selectedEmailRef.current = selectedEmail;
  }, [selectedEmail]);

  useEffect(() => {
    selectedMessageIdRef.current = selectedMessageId;
  }, [selectedMessageId]);

  /** 批量读取所有已导入邮箱的公开 JSON 收件数据。 */
  const fetchMailboxes = useCallback(
    async (targetMailboxes: BuyerMailbox[], options: { label: '导入' | '刷新'; silent?: boolean }) => {
      const target = targetMailboxes.slice(0, 3000);
      if (!target.length) {
        if (!options.silent) toast({ body: '请先粘贴 邮箱----取件码，然后点击“导入并收信”', type: 'error' });
        return;
      }
      if (loadingRef.current) return;

      loadingRef.current = true;
      setLoading(true);
      try {
        const next = await Promise.all(
          target.map(async mailbox => {
            try {
              const { apiUrl } = buildBuyerLinks(mailbox);
              const url = new URL(apiUrl);
              url.searchParams.set('sync', '1');
              url.searchParams.set('_', String(Date.now()));
              const response = await fetch(url.toString(), { cache: 'no-store' });
              const data = await response.json().catch(() => ({}));
              if (!response.ok || data.status === 'error') {
                return { email: mailbox.email, error: data.error || `请求失败：${response.status}`, messages: [], password: mailbox.password };
              }
              return { email: mailbox.email, messages: normalizeFeedData(data), password: mailbox.password };
            } catch (error) {
              return {
                email: mailbox.email,
                error: error instanceof Error ? error.message : '读取失败',
                messages: [],
                password: mailbox.password
              };
            }
          })
        );
        const nextSelected = next.find(item => item.email === selectedEmailRef.current) || next[0];
        const hasSelectedMessage = Boolean(nextSelected?.messages.some(item => item.id === selectedMessageIdRef.current));

        setResults(next);
        setSelectedEmail(nextSelected?.email || '');
        setSelectedMessageId(hasSelectedMessage ? selectedMessageIdRef.current : '');
        setLastRefreshAt(new Date().toISOString());
        if (!options.silent) {
          toast({ body: `${options.label}完成：成功 ${next.filter(item => !item.error).length}，异常 ${next.filter(item => item.error).length}` });
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const restored = mailboxes.slice(0, 3000);
    if (!restored.length) return;
    setImportedMailboxes(restored);
    void fetchMailboxes(restored, { label: '刷新', silent: true });
  }, [fetchMailboxes, mailboxes]);

  async function importAndFetch() {
    const target = mailboxes.slice(0, 3000);
    setImportedMailboxes(target);
    if (target.length) saveStoredPickupInput(input);
    await fetchMailboxes(target, { label: '导入' });
  }

  async function refreshImportedMailboxes() {
    await fetchMailboxes(importedMailboxes.length ? importedMailboxes : mailboxes, { label: '刷新' });
  }

  useEffect(() => {
    if (!importedMailboxes.length) return undefined;
    const timer = window.setInterval(() => {
      void fetchMailboxes(importedMailboxes, { label: '刷新', silent: true });
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [fetchMailboxes, importedMailboxes]);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast({ body: `${label}已复制` });
  }

  const totalMessages = results.reduce((sum, item) => sum + item.messages.length, 0);

  return (
    <Section className="public-console" padding={0}>
      <header className="public-console-header">
        <div>
          <Heading level={2}>收件工作台</Heading>
          <Text color="secondary">Inbox Console</Text>
        </div>
        <Button label="API" onClick={() => window.location.assign('/api-links')} />
      </header>
      <main className="public-console-grid">
        <aside className="public-console-sidebar">
          <Card>
            <VStack gap={4}>
              <VStack gap={1}>
                <Heading level={4}>粘贴邮箱账号</Heading>
                <Text color="secondary">每行一个，格式：邮箱----取件码，单次最多 3000 个</Text>
              </VStack>
              <TextArea
                isLabelHidden
                label="邮箱账号"
                placeholder={sample}
                rows={8}
                value={input}
                onChange={setInput}
              />
              <HStack gap={2}>
                <Button isLoading={loading} label="导入并收信" variant="primary" onClick={importAndFetch} />
                <Button
                  label="清空输入"
                  onClick={() => {
                    setInput('');
                    setImportedMailboxes([]);
                    setResults([]);
                    setSelectedEmail('');
                    setSelectedMessageId('');
                    setLastRefreshAt('');
                    saveStoredPickupInput('');
                  }}
                />
              </HStack>
              <Text color="secondary" type="supporting">
                已识别 {mailboxes.length} 个；已导入 {importedMailboxes.length} 个。导入后会每 {autoRefreshMs / 1000} 秒自动收信。
              </Text>
            </VStack>
          </Card>
          <Card>
            <VStack gap={3}>
              <HStack hAlign="between" vAlign="center">
                <Heading level={4}>邮箱列表 · {results.length}</Heading>
                <Badge label={String(results.filter(item => item.error).length)} variant="blue" />
              </HStack>
              {!results.length ? (
                <EmptyState description="导入后会显示买家的邮箱列表。" title="暂无邮箱" />
              ) : (
                <VStack className="public-mailbox-list" gap={2}>
                  {results.map((item, index) => (
                    <button
                      className={`public-mailbox-card ${item.email === selectedResult?.email ? 'active' : ''}`}
                      key={item.email}
                      type="button"
                      onClick={() => {
                        setSelectedEmail(item.email);
                        setSelectedMessageId('');
                      }}
                    >
                      <span>#{String(index + 1).padStart(3, '0')}</span>
                      <strong>{item.email}</strong>
                      <small>{item.error || `正常 · ${item.messages.length} 封`}</small>
                    </button>
                  ))}
                </VStack>
              )}
            </VStack>
          </Card>
        </aside>
        <section className="public-console-main">
          <Card>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="start" wrap="wrap">
                <VStack gap={1}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Heading level={3}>合并收件箱</Heading>
                    {loading ? <Badge label="同步中" variant="blue" /> : null}
                  </HStack>
                  <Text color="secondary">
                    合并查看 · {results.length} 个邮箱 · {totalMessages} 封邮件 · 最近刷新：
                    {formatShanghaiTime(lastRefreshAt, '尚未刷新')}
                  </Text>
                </VStack>
                <Button
                  isDisabled={!importedMailboxes.length && !mailboxes.length}
                  isLoading={loading}
                  label="刷新"
                  onClick={refreshImportedMailboxes}
                />
              </HStack>
              {isInitialLoading ? (
                <Spinner label="正在读取邮件" />
              ) : !selectedResult ? (
                <EmptyState description="请先导入邮箱账号。" title="等待导入" />
              ) : selectedResult.error ? (
                <EmptyState description={selectedResult.error} title="该邮箱读取失败" />
              ) : !selectedResult.messages.length ? (
                <EmptyState description={selectedResult.email} title="暂未收到邮件" />
              ) : (
                <VStack gap={3}>
                  {selectedResult.messages.map(message => (
                    <button
                      className={`public-message-card ${message.id === selectedMessage?.id ? 'active' : ''}`}
                      key={message.id}
                      type="button"
                      onClick={() => setSelectedMessageId(message.id)}
                    >
                      <HStack hAlign="between" vAlign="start" wrap="wrap">
                        <VStack gap={1}>
                          <strong>{message.subject || '无主题'}</strong>
                          <Text color="secondary" type="supporting">
                            {message.sender || '-'} · {formatShanghaiTime(message.receivedAt, '-')}
                          </Text>
                          <Text color="secondary" type="supporting">
                            收件邮箱：{selectedResult.email}
                          </Text>
                        </VStack>
                        {message.code ? <Badge label={`验证码 ${message.code}`} variant="green" /> : null}
                      </HStack>
                    </button>
                  ))}
                </VStack>
              )}
            </VStack>
          </Card>
          <Card>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="center" wrap="wrap">
                <VStack gap={1}>
                  <Heading level={3}>邮件预览</Heading>
                  <Text color="secondary">{selectedResult?.email || '选择一封邮件查看正文'}</Text>
                </VStack>
                {selectedMessage?.code ? (
                  <Button label="复制验证码" onClick={() => copy(selectedMessage.code!, '验证码')} />
                ) : null}
              </HStack>
              <Divider />
              {!selectedMessage ? (
                <EmptyState description="正文会在这里打开。" title="选择邮件" />
              ) : selectedMessage.bodyHtml ? (
                <MailHtmlPreview html={selectedMessage.bodyHtml} title={selectedMessage.subject || '邮件正文'} />
              ) : (
                <Text as="div" className="workbench-code workbench-mail-text">
                  {selectedMessage.bodyText || selectedMessage.preview || '无正文'}
                </Text>
              )}
            </VStack>
          </Card>
        </section>
      </main>
    </Section>
  );
};

export const Route = createFileRoute('/pickup')({
  component: PickupPage,
  staticData: { title: '收件工作台' }
});
