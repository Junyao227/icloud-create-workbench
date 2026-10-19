import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import MailHtmlPreview from '@/components/MailHtmlPreview';
import { normalizeFeedData } from '@/features/public-mail/public-mail-utils';
import { formatShanghaiTime } from '@/utils/time';

interface OpenSearch {
  limit?: number;
  mail?: string;
  pwd?: string;
}

const pageStyle: React.CSSProperties = { minHeight: '100dvh' };

function feedPath(mail: string, pwd: string, limit: number, sync = false) {
  const params = new URLSearchParams();
  params.set('mail', mail);
  params.set('pwd', pwd);
  params.set('limit', String(limit));
  if (sync) params.set('sync', '1');
  return `/console/feed.php?${params.toString()}`;
}

const ConsoleOpenPage = () => {
  const search = Route.useSearch() as OpenSearch;
  const toast = useToast();
  const [selectedId, setSelectedId] = useState('');
  const mail = String(search.mail || '');
  const pwd = String(search.pwd || '');
  const limit = Math.min(50, Math.max(1, Number(search.limit || 15)));
  const query = useQuery({
    enabled: Boolean(mail && pwd),
    queryKey: ['console-open', mail, pwd, limit],
    queryFn: async () => {
      const response = await fetch(feedPath(mail, pwd, limit, true), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status === 'error') throw new Error(data.error || `Request failed: ${response.status}`);
      return normalizeFeedData(data);
    },
    refetchInterval: 15_000,
    retry: false
  });
  const messages = query.data || [];
  const selectedMessage = messages.find(item => item.id === selectedId) || messages[0] || null;

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast({ body: `${label} copied` });
  }

  if (!mail || !pwd) {
    return (
      <Center axis="both" style={pageStyle}>
        <EmptyState description="The URL must include mail and pwd." title="Missing access params" />
      </Center>
    );
  }

  if (query.isLoading) {
    return (
      <Center axis="both" style={pageStyle}>
        <Spinner label="Loading mail" />
      </Center>
    );
  }

  if (query.isError) {
    return (
      <Center axis="both" style={pageStyle}>
        <EmptyState description={query.error instanceof Error ? query.error.message : 'Fetch failed'} title="Invalid link" />
      </Center>
    );
  }

  return (
    <Section className="public-console" padding={0}>
      <header className="public-console-header">
        <div>
          <Heading level={2}>Mail Viewer</Heading>
          <Text color="secondary">{mail}</Text>
        </div>
        <Button label="JSON" onClick={() => window.open(feedPath(mail, pwd, limit, true))} />
      </header>
      <main className="public-open-grid">
        <Card>
          <VStack gap={4}>
            <HStack hAlign="between" vAlign="center">
              <Heading level={3}>Messages · {messages.length}</Heading>
              <Badge label="15 秒自动刷新" variant="blue" />
            </HStack>
            {!messages.length ? (
              <EmptyState description={mail} title="No mail yet" />
            ) : (
              <VStack gap={3}>
                {messages.map(message => (
                  <button
                    className={`public-message-card ${message.id === selectedMessage?.id ? 'active' : ''}`}
                    key={message.id}
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                  >
                    <HStack hAlign="between" vAlign="start" wrap="wrap">
                      <VStack gap={1}>
                        <strong>{message.subject || 'No subject'}</strong>
                        <Text color="secondary" type="supporting">
                          {message.sender || '-'} · {formatShanghaiTime(message.receivedAt, '-')}
                        </Text>
                      </VStack>
                      {message.code ? <Badge label={`Code ${message.code}`} variant="green" /> : null}
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
                <Heading level={3}>Preview</Heading>
                <Text color="secondary">{selectedMessage?.subject || 'Select a message'}</Text>
              </VStack>
              {selectedMessage?.code ? <Button label="Copy code" onClick={() => copy(selectedMessage.code!, 'Code')} /> : null}
            </HStack>
            <Divider />
            {!selectedMessage ? (
              <EmptyState description="Message body will open here." title="Select mail" />
            ) : selectedMessage.bodyHtml ? (
              <MailHtmlPreview html={selectedMessage.bodyHtml} title={selectedMessage.subject || 'Mail body'} />
            ) : (
              <Text as="div" className="workbench-code workbench-mail-text">
                {selectedMessage.bodyText || selectedMessage.preview || 'No body'}
              </Text>
            )}
          </VStack>
        </Card>
      </main>
    </Section>
  );
};

export const Route = createFileRoute('/console/open-php')({
  component: ConsoleOpenPage,
  validateSearch: (search: Record<string, unknown>): OpenSearch => ({
    limit: Number(search.limit || 15),
    mail: String(search.mail || ''),
    pwd: String(search.pwd || '')
  }),
  staticData: { title: 'Mail Viewer' }
});
