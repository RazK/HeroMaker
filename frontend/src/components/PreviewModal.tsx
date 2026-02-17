import { ImagePreview } from './ImagePreview';
import { ModelPreview } from './ModelPreview';
import { api } from '../api/client';
import './PreviewModal.css';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  creationId: string;
  stepName: string;
  displayName: string;
  fileUrl: string;
  outputFile: string;
  walkingUrl?: string | null;
  riggedUrl?: string | null;
  canDownload: boolean;
}

export function PreviewModal({
  isOpen,
  onClose,
  creationId,
  stepName,
  displayName,
  fileUrl,
  outputFile,
  walkingUrl,
  riggedUrl,
  canDownload,
}: PreviewModalProps) {
  if (!isOpen) return null;

  const isImageStep = outputFile.endsWith('.jpg') || outputFile.endsWith('.png');
  const isModelStep = outputFile.endsWith('.glb');

  const handleDownload = async () => {
    try {
      await api.downloadFile(creationId, outputFile);
    } catch (error) {
      console.error('Failed to download file:', error);
      alert(`Failed to download ${outputFile}`);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="preview-modal-backdrop" onClick={handleBackdropClick}>
      <div className="preview-modal">
        <div className="preview-modal-header">
          <h3 className="preview-modal-title">{displayName}</h3>
          <button className="preview-modal-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="preview-modal-content">
          {isImageStep && <ImagePreview src={fileUrl} alt={displayName} />}
          {isModelStep && (
            <ModelPreview
              url={fileUrl}
              isRigged={stepName === 'meshy_rig'}
              walkingUrl={walkingUrl}
              riggedUrl={riggedUrl}
            />
          )}
        </div>
        {canDownload && (
        <div className="preview-modal-footer">
          <button className="preview-modal-download" onClick={handleDownload}>
            Download
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
