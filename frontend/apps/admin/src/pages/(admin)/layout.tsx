import { AppShell } from '@astryxdesign/core/AppShell';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { BookOpen, Clock3, Inbox, KeyRound, LayoutDashboard, Mail, Search } from 'lucide-react';

import SystemLogo from '@/components/SystemLogo';
import UserAvatar from '@/features/auth/components/UserAvatar';
import { guardAdminRoute } from '@/features/router/guard';
import type { AdminRouteGuardOptions, AdminRouteGuardResult } from '@/features/router/guard';

const NAV_ITEMS = [
  { href: '/home', icon: LayoutDashboard, label: '控制台概览' },
  { href: '/accounts', icon: KeyRound, label: 'CK 账号' },
  { href: '/tasks', icon: Clock3, label: '生产任务' },
  { href: '/addresses', icon: Mail, label: '邮箱库存' },
  { href: '/inbox', icon: Inbox, label: '收件与验证码' },
  { href: '/messages', icon: Search, label: '邮件搜索' },
  { href: '/guide', icon: BookOpen, label: 'CK 获取指南' }
] as const;

const AdminLayout = () => {
  const { pathname } = useLocation();

  return (
    <AppShell
      contentPadding={0}
      mobileNav={{ breakpoint: 'md' }}
      sideNav={
        <SideNav
          className="workbench-side-nav"
          collapsible
          resizable={{ autoSaveId: 'icloud-workbench-nav', defaultWidth: 248, minWidth: 208, maxWidth: 340 }}
        >
          <SideNavSection isHeaderHidden title="导航">
            {NAV_ITEMS.map(item => (
              <SideNavItem
                href={item.href}
                icon={item.icon}
                isSelected={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                key={item.href}
                label={item.label}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
      topNav={
        <TopNav
          endContent={<UserAvatar />}
          heading={<TopNavHeading heading="iCloud 工作台" headingHref="/home" logo={<SystemLogo className="size-24px" />} />}
          label="工作台顶部导航"
        />
      }
      variant="elevated"
    >
      <Outlet />
    </AppShell>
  );
};

function beforeLoadAdminRoute(options: AdminRouteGuardOptions): AdminRouteGuardResult {
  return guardAdminRoute(options);
}

export const Route = createFileRoute('/(admin)')({
  component: AdminLayout,
  beforeLoad: beforeLoadAdminRoute as any
});
