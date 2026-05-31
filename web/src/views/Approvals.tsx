// 承認フロー（/approvals）— ナビ再編フェーズ1（MC-76）ではナビ項目の枠だけ用意し、
// 中身は MC-79 で実装する。現状は「準備中」の最小ビュー。
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/ui';

export default function Approvals() {
  return (
    <div>
      <PageHeader title="承認フロー" subtitle="Keita の承認が必要なアクションを集約します" />
      <div className="p-4 md:p-6">
        <EmptyState>承認フローは準備中です。</EmptyState>
      </div>
    </div>
  );
}
