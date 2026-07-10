/**
 * Dashboard PDF document for export.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica' },
  title: { fontSize: 16, marginBottom: 8, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 10, marginBottom: 16, color: '#444' },
  kpiRow: { flexDirection: 'row', marginBottom: 16, gap: 12 },
  kpiBox: { flex: 1, padding: 8, backgroundColor: '#f5f5f5', borderRadius: 4 },
  kpiLabel: { fontSize: 8, color: '#666' },
  kpiValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#333',
    color: '#fff',
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', padding: 3, fontSize: 7 },
  colDate: { width: '12%' },
  colStore: { width: '10%' },
  colTemplate: { width: '18%' },
  colStatus: { width: '12%' },
  colPct: { width: '10%' },
  colItem: { width: '20%' },
  colItemStatus: { width: '18%' },
  footer: { position: 'absolute', bottom: 24, left: 32, right: 32, fontSize: 7, color: '#c00' },
  warning: { backgroundColor: '#fff3cd', padding: 8, marginBottom: 12, fontSize: 8, color: '#856404' },
});

function formatScopeLabel(params) {
  if (params.scope === 'full_history') return 'Full accessible history';
  return `${params.startDate ?? ''} — ${params.endDate ?? ''}`;
}

export function DashboardPdfDocument({ params, reports, kpis, mediaExpiryFooter }) {
  const rows = [];
  for (const report of reports.slice(0, 500)) {
    const responses = report.responses ?? [];
    if (!responses.length) {
      rows.push({ report, resp: null });
    } else {
      for (const resp of responses.slice(0, 20)) {
        rows.push({ report, resp });
      }
    }
  }

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(Text, { style: styles.title }, 'Operation Dashboard Export'),
      React.createElement(Text, { style: styles.subtitle }, `Period: ${formatScopeLabel(params)}`),
      React.createElement(
        View,
        { style: styles.warning },
        React.createElement(Text, null, mediaExpiryFooter),
      ),
      React.createElement(
        View,
        { style: styles.kpiRow },
        React.createElement(
          View,
          { style: styles.kpiBox },
          React.createElement(Text, { style: styles.kpiLabel }, 'Total Reports'),
          React.createElement(Text, { style: styles.kpiValue }, String(kpis.reportCount)),
        ),
        React.createElement(
          View,
          { style: styles.kpiBox },
          React.createElement(Text, { style: styles.kpiLabel }, 'Avg Completion'),
          React.createElement(Text, { style: styles.kpiValue }, `${kpis.avgCompletion}%`),
        ),
        React.createElement(
          View,
          { style: styles.kpiBox },
          React.createElement(Text, { style: styles.kpiLabel }, 'Avg Compliance'),
          React.createElement(Text, { style: styles.kpiValue }, `${kpis.avgCompliance}%`),
        ),
        React.createElement(
          View,
          { style: styles.kpiBox },
          React.createElement(Text, { style: styles.kpiLabel }, 'Failed Items'),
          React.createElement(Text, { style: styles.kpiValue }, String(kpis.failedItemCount)),
        ),
      ),
      React.createElement(
        View,
        { style: styles.tableHeader },
        React.createElement(Text, { style: styles.colDate }, 'Date'),
        React.createElement(Text, { style: styles.colStore }, 'Store'),
        React.createElement(Text, { style: styles.colTemplate }, 'Template'),
        React.createElement(Text, { style: styles.colStatus }, 'Status'),
        React.createElement(Text, { style: styles.colPct }, 'Complete'),
        React.createElement(Text, { style: styles.colItem }, 'Item'),
        React.createElement(Text, { style: styles.colItemStatus }, 'Item Status'),
      ),
      ...rows.map(({ report, resp }, i) =>
        React.createElement(
          View,
          { key: i, style: styles.tableRow },
          React.createElement(Text, { style: styles.colDate }, report.reportDate),
          React.createElement(Text, { style: styles.colStore }, report.storeCode),
          React.createElement(Text, { style: styles.colTemplate }, report.templateName),
          React.createElement(Text, { style: styles.colStatus }, report.status),
          React.createElement(Text, { style: styles.colPct }, `${report.completionPercent ?? 0}%`),
          React.createElement(Text, { style: styles.colItem }, resp?.title ?? '—'),
          React.createElement(Text, { style: styles.colItemStatus }, resp?.status ?? '—'),
        ),
      ),
      React.createElement(Text, { style: styles.footer, fixed: true }, mediaExpiryFooter),
    ),
  );
}
