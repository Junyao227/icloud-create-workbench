import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Pagination } from '@astryxdesign/core/Pagination';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Table, type TableColumn, pixel, proportional, useTableSelection } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import ActionDialog from '@/components/ActionDialog';
import MailDrawer from '@/components/MailDrawer';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { apiFetch, downloadTextFile, queryString } from '@/service/workbench';
import type { Account, Address, Pagination as PageInfo } from '@/types/workbench';

interface PublicLinks {
  apiUrl: string;
  token: string;
  viewerUrl: string;
}
interface AddressFilters {
  accountId: string;
  search: string;
  state: string;
}
type AddressRow = Address & Record<string, unknown>;

const EMPTY_FILTERS: AddressFilters = { accountId: '', search: '', state: '' };

/** 渲染邮箱库存、批量状态、邮件与开放链接操作。 */
const AddressesPage = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mailAddress, setMailAddress] = useState<Address>();
  const [links, setLinks] = useState<PublicLinks>();
  const [revokeTarget, setRevokeTarget] = useState<Address>();
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch<{ accounts: Account[] }>('/api/icloud-accounts')
  });
  const addresses = useQuery({
    queryKey: ['addresses', page, filters],
    queryFn: () =>
      apiFetch<{ addresses: Address[]; pagination: PageInfo }>(
        `/api/addresses?${queryString({ ...filters, page, pageSize: 20 })}`
      )
  });
  const publicMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<PublicLinks>(`/api/addresses/${id}/public-access`, { body: '{}', method: 'POST' }),
    onError: error => toast({ body: error instanceof Error ? error.message : '开放链接生成失败', type: 'error' }),
    onSuccess: async data => {
      setLinks(data);
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
    }
  });

  const rows = (addresses.data?.addresses || []) as AddressRow[];
  const selectionPlugin = useTableSelection<AddressRow>({
    getIsAllSelected: () => rows.length > 0 && rows.every(item => selected.has(item.id)),
    getIsIndeterminate: () => {
      const count = rows.filter(item => selected.has(item.id)).length;
      return count > 0 && count < rows.length;
    },
    getIsItemSelected: item => selected.has(item.id),
    onSelectAll: ({ isAllSelected }) => setSelected(isAllSelected ? new Set(rows.map(item => item.id)) : new Set()),
    onSelectItem: ({ isSelected, item }) => {
      const next = new Set(selected);
      if (isSelected) next.add(item.id);
      else next.delete(item.id);
      setSelected(next);
    }
  });

  /** 应用当前筛选条件并返回第一页。 */
  function applyFilters() {
    setPage(1);
    setSelected(new Set());
    setFilters(draftFilters);
  }

  /** 导出当前输入的筛选结果。 */
  function exportFilteredAddresses() {
    window.location.assign(`/api/addresses/export?${queryString({ ...draftFilters })}`);
  }

  /** 有勾选时导出勾选邮箱；未勾选时按当前输入的筛选条件导出 MMA。 */
  async function exportMmaAddresses() {
    try {
      if (selected.size) {
        await downloadTextFile(
          '/api/addresses/export-mma',
          {
            body: JSON.stringify({ ids: [...selected] }),
            method: 'POST'
          },
          'hidden-addresses-mma.txt'
        );
        toast({ body: `已导出选中的 ${selected.size} 个邮箱` });
        return;
      }
      window.location.assign(`/api/addresses/export-mma?${queryString({ ...draftFilters })}`);
    } catch (error) {
      toast({ body: error instanceof Error ? error.message : 'MMA 导出失败', type: 'error' });
    }
  }

  /** 批量修改选中邮箱状态。 */
  async function batchState(state: string) {
    if (!selected.size) {
      toast({ body: '请先选择邮箱', type: 'error' });
      return;
    }
    try {
      await apiFetch('/api/addresses/batch-state', {
        body: JSON.stringify({ ids: [...selected], state }),
        method: 'PATCH'
      });
      setSelected(new Set());
      toast({ body: '批量状态已更新' });
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
    } catch (error) {
      toast({ body: error instanceof Error ? error.message : '批量状态更新失败', type: 'error' });
    }
  }

  /** 撤销指定邮箱的开放访问。 */
  async function revokeAccess() {
    if (!revokeTarget) return;
    try {
      await apiFetch(`/api/addresses/${revokeTarget.id}/public-access`, { method: 'DELETE' });
      setRevokeTarget(undefined);
      toast({ body: '开放链接已撤销' });
      await queryClient.invalidateQueries({ queryKey: ['addresses'] });
    } catch (error) {
      toast({ body: error instanceof Error ? error.message : '开放链接撤销失败', type: 'error' });
    }
  }

  /** 复制开放邮件地址或密钥。 */
  async function copyPublicValue(value: string | undefined, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast({ body: `${label}已复制` });
  }

  const columns: TableColumn<AddressRow>[] = [
    {
      key: 'email',
      header: '邮箱',
      width: proportional(2),
      renderCell: row => <Text className="workbench-code">{String(row.email)}</Text>
    },
    { key: 'appleId', header: 'Apple ID', width: proportional(1.5) },
    { key: 'label', header: '标签', width: proportional(1) },
    { key: 'state', header: '状态', width: pixel(100), renderCell: row => <StatusBadge value={String(row.state)} /> },
    {
      key: 'messageCount',
      header: '邮件',
      width: pixel(120),
      renderCell: row => (
        <Text>
          {Number(row.messageCount || 0)}
          {row.latestCode ? ` · ${String(row.latestCode)}` : ''}
        </Text>
      )
    },
    {
      key: 'actions',
      header: '操作',
      width: pixel(320),
      renderCell: row => (
        <HStack gap={1} wrap="wrap">
          <Button label="邮件" size="sm" onClick={() => setMailAddress(row)} />
          <Button
            label={row.publicAccessEnabled ? '重置链接' : '开放链接'}
            size="sm"
            variant="primary"
            onClick={() => publicMutation.mutate(row.id)}
          />
          {row.publicAccessEnabled ? (
            <Button label="撤销" size="sm" variant="destructive" onClick={() => setRevokeTarget(row)} />
          ) : null}
        </HStack>
      )
    }
  ];

  return (
    <Section className="workbench-page" padding={6}>
      <VStack gap={5}>
        <PageHeader
          description="筛选、批量管理邮箱状态并查看关联邮件。"
          title="邮箱库存"
        />
        <VStack gap={3}>
          <HStack gap={3} vAlign="end" wrap="wrap">
            <Selector
              hasClear
              isLabelHidden
              label="CK 账号筛选"
              options={(accounts.data?.accounts || []).map(item => ({ label: item.appleId, value: item.id }))}
              placeholder="全部 CK"
              value={draftFilters.accountId}
              onChange={accountId => setDraftFilters(current => ({ ...current, accountId: accountId || '' }))}
            />
            <Selector
              hasClear
              isLabelHidden
              label="邮箱状态筛选"
              options={[
                { label: '未使用', value: 'unused' },
                { label: '已使用', value: 'used' },
                { label: '垃圾箱', value: 'trash' }
              ]}
              placeholder="全部状态"
              value={draftFilters.state}
              onChange={state => setDraftFilters(current => ({ ...current, state: state || '' }))}
            />
            <TextInput
              hasClear
              isLabelHidden
              label="搜索邮箱或标签"
              placeholder="搜索邮箱或标签"
              value={draftFilters.search}
              onChange={search => setDraftFilters(current => ({ ...current, search: search || '' }))}
              onEnter={applyFilters}
            />
            <Button label="查询" variant="primary" onClick={applyFilters} />
            <Button label="筛选导出" onClick={exportFilteredAddresses} />
            <Button label={selected.size ? '导出选中 MMA' : '筛选导出 MMA'} onClick={exportMmaAddresses} />
          </HStack>
          <HStack gap={2} wrap="wrap">
            <Button label="批量已使用" onClick={() => batchState('used')} />
            <Button label="批量未使用" onClick={() => batchState('unused')} />
            <Button label="批量垃圾箱" variant="destructive" onClick={() => batchState('trash')} />
            <Text color="secondary">已选择 {selected.size} 项</Text>
          </HStack>
        </VStack>
        <Card padding={0}>
          {addresses.isLoading ? (
            <VStack hAlign="center" padding={8}>
              <Spinner label="正在加载邮箱库存" />
            </VStack>
          ) : (
            <div className="workbench-table-scroll">
              <Table<AddressRow>
                columns={columns}
                data={rows}
                density="compact"
                dividers="rows"
                hasHover
                idKey="id"
                plugins={{ selection: selectionPlugin }}
              />
            </div>
          )}
        </Card>
        <HStack hAlign="end">
          <Pagination
            label="邮箱库存分页"
            page={addresses.data?.pagination.page || 1}
            pageSize={20}
            totalItems={addresses.data?.pagination.total || 0}
            onChange={next => {
              setPage(next);
              setSelected(new Set());
            }}
          />
        </HStack>
      </VStack>
      <MailDrawer
        addressId={mailAddress?.id}
        email={mailAddress?.email}
        open={Boolean(mailAddress)}
        onClose={() => setMailAddress(undefined)}
      />
      <ActionDialog
        isOpen={Boolean(links)}
        primaryLabel="完成"
        title="开放邮件链接（密钥仅展示一次）"
        onOpenChange={next => {
          if (!next) setLinks(undefined);
        }}
        onPrimary={() => setLinks(undefined)}
      >
        <VStack gap={4}>
          <VStack gap={1}>
            <HStack hAlign="between" vAlign="center">
              <Text weight="bold">JSON 接口</Text>
              <Button label="复制" size="sm" onClick={() => copyPublicValue(links?.apiUrl, 'JSON 接口')} />
            </HStack>
            <Text className="workbench-code">{links?.apiUrl}</Text>
          </VStack>
          <VStack gap={1}>
            <HStack hAlign="between" vAlign="center">
              <Text weight="bold">公开查看页</Text>
              <Button label="复制" size="sm" onClick={() => copyPublicValue(links?.viewerUrl, '公开查看页')} />
            </HStack>
            <Text className="workbench-code">{links?.viewerUrl}</Text>
          </VStack>
          <VStack gap={1}>
            <HStack hAlign="between" vAlign="center">
              <Text weight="bold">密钥</Text>
              <Button label="复制" size="sm" onClick={() => copyPublicValue(links?.token, '密钥')} />
            </HStack>
            <Text className="workbench-code">{links?.token}</Text>
          </VStack>
        </VStack>
      </ActionDialog>
      <AlertDialog
        actionLabel="撤销开放链接"
        cancelLabel="取消"
        description="撤销后旧链接会立即失效。"
        isOpen={Boolean(revokeTarget)}
        title="确认撤销开放访问？"
        onAction={revokeAccess}
        onOpenChange={next => {
          if (!next) setRevokeTarget(undefined);
        }}
      />
    </Section>
  );
};

export const Route = createFileRoute('/(admin)/addresses/')({
  component: AddressesPage,
  staticData: { title: '邮箱库存', menu: { icon: 'mdi:email-multiple', order: 4 } }
});
