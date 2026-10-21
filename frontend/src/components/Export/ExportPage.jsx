import './ExportPage.css';
import UsbExportPanel from '../TrackAnalysis/UsbExportPanel';
import React from 'react';

const ExportPage = () => (
  <main className="export-page">
    <UsbExportPanel wizard />
  </main>
);

export default ExportPage;
