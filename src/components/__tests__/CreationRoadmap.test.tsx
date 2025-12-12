import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreationRoadmap } from '../CreationRoadmap';

describe('CreationRoadmap', () => {
  it('normalizes tasks and highlights the current one', () => {
    render(
      <CreationRoadmap
        currentTask="webcam_scan"
        tasks={[
          { name: 'webcam_scan', status: 'processing' },
          { name: 'chatgpt_render', status: 'pending' },
        ]}
      />
    );

    // Known tasks are rendered even if not supplied in the payload
    expect(screen.getByText(/image processing/i)).toBeInTheDocument();

    // Current task receives the active indicator chip
    const activeRow = screen.getByText(/webcam scan/i).closest('li');
    expect(activeRow).toHaveClass('is-active');
  });
});
