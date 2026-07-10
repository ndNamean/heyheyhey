/**
 * Server-side PDF rendering for exports.
 */

import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { DashboardPdfDocument } from './DashboardPdfDocument.js';
import { ReviewStatusPdfDocument } from './ReviewStatusPdfDocument.js';
import { computeDashboardKpis } from '../review-status-rows.js';

export async function renderExportPdf({
  exportType,
  params,
  reports,
  statusRows,
  mediaExpiryFooter,
}) {
  let doc;

  if (exportType === 'dashboard') {
    const kpis = computeDashboardKpis(reports);
    doc = React.createElement(DashboardPdfDocument, {
      params,
      reports,
      kpis,
      mediaExpiryFooter,
    });
  } else {
    doc = React.createElement(ReviewStatusPdfDocument, {
      params,
      statusRows,
      mediaExpiryFooter,
    });
  }

  return renderToBuffer(doc);
}
