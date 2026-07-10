/**
 * Review status PDF document for export.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica' },
  title: { fontSize: 16, marginBottom: 8, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 10, marginBottom: 16, color: '#444' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#333',
    color: '#fff',
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', padding: 3, fontSize: 7 },
  colDate: { width: '10%' },
  colStore: { width: '8%' },
  colSubmitter: { width: '12%' },
  colStatus: { width: '10%' },
  colReview: { width: '12%' },
  colFeedback: { width: '18%' },
  colFinal: { width: '12%' },
  colLead: { width: '10%' },
  colCorrection: { width: '8%' },
  footer: { position: 'absolute', bottom: 24, left: 32, right: 32, fontSize: 7, color: '#c00' },
  warning: { backgroundColor: '#fff3cd', padding: 8, marginBottom: 12, fontSize: 8, color: '#856404' },
});

function formatScopeLabel(params) {
  if (params.scope === 'all_assigned') return 'All assigned reports';
  return `Last ${params.daysBack ?? 30} days`;
}

function formatMs(ms) {
  if (ms == null) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function ReviewStatusPdfDocument({ params, statusRows, mediaExpiryFooter }) {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', orientation: 'landscape', style: styles.page },
      React.createElement(Text, { style: styles.title }, 'Report Review Status Export'),
      React.createElement(Text, { style: styles.subtitle }, formatScopeLabel(params)),
      React.createElement(
        View,
        { style: styles.warning },
        React.createElement(Text, null, mediaExpiryFooter),
      ),
      React.createElement(
        View,
        { style: styles.tableHeader },
        React.createElement(Text, { style: styles.colDate }, 'Date'),
        React.createElement(Text, { style: styles.colStore }, 'Store'),
        React.createElement(Text, { style: styles.colSubmitter }, 'Submitted By'),
        React.createElement(Text, { style: styles.colStatus }, 'Status'),
        React.createElement(Text, { style: styles.colReview }, 'Latest Review'),
        React.createElement(Text, { style: styles.colFeedback }, 'Feedback'),
        React.createElement(Text, { style: styles.colFinal }, 'Finalized'),
        React.createElement(Text, { style: styles.colLead }, 'Lead Time'),
        React.createElement(Text, { style: styles.colCorrection }, 'Correction'),
      ),
      ...statusRows.slice(0, 500).map((row, i) =>
        React.createElement(
          View,
          { key: i, style: styles.tableRow },
          React.createElement(Text, { style: styles.colDate }, row.reportDate),
          React.createElement(Text, { style: styles.colStore }, row.storeCode),
          React.createElement(Text, { style: styles.colSubmitter }, row.submittedBy),
          React.createElement(Text, { style: styles.colStatus }, row.status),
          React.createElement(Text, { style: styles.colReview }, row.latestReviewTime),
          React.createElement(Text, { style: styles.colFeedback }, row.latestFeedback || '—'),
          React.createElement(Text, { style: styles.colFinal }, row.finalizedTime),
          React.createElement(Text, { style: styles.colLead }, formatMs(row.leadTimeMs)),
          React.createElement(Text, { style: styles.colCorrection }, formatMs(row.correctionDurationMs)),
        ),
      ),
      React.createElement(Text, { style: styles.footer, fixed: true }, mediaExpiryFooter),
    ),
  );
}
