import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import PageHeader from '@/components/PageHeader';
import { apiFetch, queryString } from '@/service/workbench';
import type { Account, MailMessage, Pagination } from '@/types/workbench';
import { formatShanghaiTime } from '@/utils/time';

interface InboxConfig {
  configured: boolean;
  email?: string;
  host?: string;
  lastError?: string;
  lastSyncAt?: string;
  mailbox?: string;
  nextSyncAt?: string;
  port?: number;
  secure?: boolean;
}
interface InboxFormValues {
  email: string;
  host: string;
  mailbox: string;
  password: string;
  port: number;
  secure: boolean;
}

const EMPTY_FORM: InboxFormValues = { email: '', host: '', mailbox: 'INBOX', password: '', port: 993, secure: true };

/** 渲染每条 CK 独立的 IMAP 配置、同步状态和邮件列表。 */
const InboxPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [accountId, setAccountId] = useState('');
  const [formValues, setFormValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({ email: '', host: '' });
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: Account[] }>('/api/icloud-accounts')
  });

  useEffect(() => {
    if (!accountId && accounts.data?.accounts[0]) setAccountId(accounts.data.accounts[0].id);
  }, [accountId, accounts.data]);

  const config = useQuery({
    enabled: Boolean(accountId),
    queryKey: ['inbox-config', accountId],
    queryFn: () => apiFetch<InboxConfig>(`/api/inbox/config?accountId=${accountId}`)
  });
  const mails = useQuery({
    enabled: Boolean(accountId),
    queryKey: ['inbox-mails', accountId],
    queryFn: () =>
      apiFetch<{ messages: MailMessage[]; pagination: Pagination }>(
        `/api/inbox/messages?${queryString({ accountId, page: 1, pageSize: 20 })}`
      ),
    refetchInterval: 30_000
  });

  useEffect(() => {
    if (!config.data) return;
    setFormValues({
      email: config.data.email || '',
      host: config.data.host || '',
      mailbox: config.data.mailbox || 'INBOX',
      password: '',
      port: config.data.port || 993,
      secure: config.data.secure ?? true
    });
  }, [config.data]);

  const saveMutation = useMutation({
    mutationFn: (values: InboxFormValues) =>
      apiFetch('/api/inbox/config', { body: JSON.stringify({ ...values, accountId }), method: 'PUT' }),
    onError: error => toast({ body: error instanceof Error ? error.message : 'IMAP 配置保存失败', type: 'error' }),
    onSuccess: async () => {
      toast({ body: 'IMAP 配置已保存' });
      setFormValues(current => ({ ...current, password: '' }));
      await queryClient.invalidateQueries({ queryKey: ['inbox-config', accountId] });
    }
  });

  /** 校验并保存当前 CK 的 IMAP 配置。 */
  function saveConfig() {
    const nextErrors = {
      email: formValues.email.trim() ? '' : '请输入邮箱',
      host: formValues.host.trim() ? '' : '请输入 IMAP 主机'
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.host) return;
    saveMutation.mutate(formValues);
  }

  /** 手动同步当前 CK 的新邮件。 */
  async function sync() {
    try {
      const result = await apiFetch<{ added: number; scanned: number }>('/api/inbox/sync', {
        body: JSON.stringify({ accountId }),
        method: 'POST'
      });
      toast({ body: `扫描 ${result.scanned} 封，新增 ${result.added} 封` });
      await queryClient.invalidateQueries({ queryKey: ['inbox-mails', accountId] });
      await queryClient.invalidateQueries({ queryKey: ['inbox-config', accountId] });
    } catch (error) {
      toast({ body: error instanceof Error ? error.message : '邮件同步失败', type: 'error' });
    }
  }

  const messages = mails.data?.messages || [];

  /** 渲染最近邮件列表。 */
  function renderMessages() {
    if (mails.isLoading) return <Spinner label="正在加载最近邮件" />;
    if (!messages.length) return <Text color="secondary">暂无邮件</Text>;
    return messages.map((item, index) => (
      <VStack gap={3} key={item.id}>
        {index ? <Divider /> : null}
        <HStack hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Text weight="bold">{item.subject || '无主题'}</Text>
            <Text color="secondary" type="supporting">
              {item.hiddenEmail || '未匹配隐私邮箱'} · {formatShanghaiTime(item.receivedAt)}
            </Text>
          </VStack>
          {item.code ? <Badge label={item.code} variant="blue" /> : null}
        </HStack>
      </VStack>
    ));
  }

  return (
    <Section className="workbench-page" padding={6}>
      <VStack gap={6}>
        <PageHeader
          actions={
            <HStack gap={2}>
              <Button label="邮件搜索" onClick={() => navigate({ to: '/messages' })} />
              <Button isDisabled={!accountId} label="立即同步" variant="primary" onClick={sync} />
            </HStack>
          }
          description="为每条 CK 独立配置 IMAP，并自动提取邮件验证码。"
          title="收件与验证码"
        />
        <Selector
          label="当前 CK"
          options={(accounts.data?.accounts || []).map(item => ({ label: item.appleId, value: item.id }))}
          placeholder="选择 CK"
          value={accountId}
          onChange={value => setAccountId(value || '')}
        />
        <Grid columns={{ minWidth: 340, repeat: 'fit' }} gap={5}>
          <VStack gap={4}>
            <Heading level={3}>IMAP 配置</Heading>
            <Grid columns={{ minWidth: 180, repeat: 'fit' }} gap={3}>
              <TextInput
                isRequired
                label="IMAP 主机"
                status={errors.host ? { message: errors.host, type: 'error' } : undefined}
                value={formValues.host}
                onChange={host => {
                  setErrors(current => ({ ...current, host: '' }));
                  setFormValues(current => ({ ...current, host }));
                }}
              />
              <NumberInput
                label="端口"
                max={65535}
                min={1}
                value={formValues.port}
                onChange={port => setFormValues(current => ({ ...current, port }))}
              />
            </Grid>
            <TextInput
              isRequired
              label="邮箱"
              type="email"
              status={errors.email ? { message: errors.email, type: 'error' } : undefined}
              value={formValues.email}
              onChange={email => {
                setErrors(current => ({ ...current, email: '' }));
                setFormValues(current => ({ ...current, email }));
              }}
            />
            <TextInput
              description="留空表示不修改已保存的密码。"
              isOptional
              label="密码/授权码"
              type="password"
              value={formValues.password}
              onChange={password => setFormValues(current => ({ ...current, password }))}
            />
            <Grid columns={{ minWidth: 180, repeat: 'fit' }} gap={3}>
              <TextInput
                label="文件夹"
                value={formValues.mailbox}
                onChange={mailbox => setFormValues(current => ({ ...current, mailbox }))}
              />
              <Switch
                label="使用 SSL/TLS"
                value={formValues.secure}
                onChange={secure => setFormValues(current => ({ ...current, secure }))}
              />
            </Grid>
            <Button
              isLoading={saveMutation.isPending}
              label="保存当前 CK 配置"
              variant="primary"
              onClick={saveConfig}
            />
          </VStack>
          <Card>
            <VStack gap={3}>
              <HStack hAlign="between" vAlign="center">
                <Heading level={3}>同步状态</Heading>
                {config.data?.lastError ? (
                  <Badge label="异常" variant="error" />
                ) : (
                  <Badge label="正常" variant="success" />
                )}
              </HStack>
              {config.isLoading ? (
                <Spinner label="正在加载同步状态" />
              ) : (
                <>
                  <Text color="secondary">最近同步：{formatShanghaiTime(config.data?.lastSyncAt, '尚未同步')}</Text>
                  <Text color="secondary">下次同步：{formatShanghaiTime(config.data?.nextSyncAt, '-')}</Text>
                  {config.data?.lastError ? (
                    <Text style={{ color: 'var(--color-text-error)' }}>{config.data.lastError}</Text>
                  ) : null}
                </>
              )}
            </VStack>
          </Card>
        </Grid>
        <Divider />
        <VStack gap={4}>
          <HStack hAlign="between" vAlign="center" wrap="wrap">
            <Heading level={3}>最近邮件</Heading>
            <Button label="搜索全部邮件" onClick={() => navigate({ to: '/messages' })} />
          </HStack>
          {renderMessages()}
        </VStack>
      </VStack>
    </Section>
  );
};

export const Route = createFileRoute('/(admin)/inbox/')({
  component: InboxPage,
  staticData: { title: '收件与验证码', menu: { icon: 'mdi:email-fast', order: 5 } }
});
