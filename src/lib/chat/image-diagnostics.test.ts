import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDiagnostics,
  recordDecision,
  recordQueries,
  recordProviderResult,
  recordSSEEvent,
  recordFrontendEvent,
  recordMessageImages,
  recordGalleryMounted,
  recordProxyRequest,
  recordImageLoad,
  getDiagnostics,
  clearDiagnostics,
} from './image-diagnostics';

describe('Image Search Diagnostics (Frontend)', () => {
  const testRequestId = 'test-req-123';

  beforeEach(() => {
    // Mock VITE_IMAGE_SEARCH_DEBUG
    import.meta.env.VITE_IMAGE_SEARCH_DEBUG = 'true';
    clearDiagnostics(testRequestId);
  });

  it('initializes diagnostics', () => {
    initDiagnostics(testRequestId);
    const diag = getDiagnostics(testRequestId);
    expect(diag).toBeDefined();
    expect(diag?.requestId).toBe(testRequestId);
  });

  it('records decision', () => {
    initDiagnostics(testRequestId);
    recordDecision(testRequestId, 'heuristic', 'high', 'visual query detected');
    const diag = getDiagnostics(testRequestId);
    expect(diag?.decision.heuristic).toBe('heuristic');
    expect(diag?.decision.confidence).toBe('high');
  });

  it('records queries', () => {
    initDiagnostics(testRequestId);
    const queries = ['golden retrievers', 'puppies'];
    recordQueries(testRequestId, queries);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.queries.generated).toEqual(queries);
    expect(diag?.queries.count).toBe(2);
  });

  it('records provider result', () => {
    initDiagnostics(testRequestId);
    recordProviderResult(
      testRequestId,
      'google-cse',
      10,
      10,
      8,
      ['images.google.com', 'pinterest.com'],
      'success',
      null,
    );
    const diag = getDiagnostics(testRequestId);
    expect(diag?.provider.name).toBe('google-cse');
    expect(diag?.provider.rawCount).toBe(10);
    expect(diag?.provider.filteredCount).toBe(8);
  });

  it('records SSE events', () => {
    initDiagnostics(testRequestId);
    recordSSEEvent(testRequestId, 'started');
    recordSSEEvent(testRequestId, 'results', 5);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.sse.eventsEmitted).toBe(2);
    expect(diag?.sse.started).toBe(true);
    expect(diag?.sse.totalImagesEmitted).toBe(5);
  });

  it('records frontend events', () => {
    initDiagnostics(testRequestId);
    recordFrontendEvent(testRequestId, 'received');
    recordFrontendEvent(testRequestId, 'parsed', 5);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.frontend.eventsReceived).toBe(1);
    expect(diag?.frontend.parsedImageCount).toBe(5);
  });

  it('records message images', () => {
    initDiagnostics(testRequestId);
    recordMessageImages(testRequestId, 5);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.message.imageCount).toBe(5);
  });

  it('records gallery mounted', () => {
    initDiagnostics(testRequestId);
    recordGalleryMounted(testRequestId, true);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.gallery.mounted).toBe(true);
    expect(diag?.gallery.renderCount).toBe(1);
  });

  it('records proxy request', () => {
    initDiagnostics(testRequestId);
    recordProxyRequest(
      testRequestId,
      'https://images.example.com/photo.jpg?secret=key',
      200,
      'image/jpeg',
      12345,
    );
    const diag = getDiagnostics(testRequestId);
    expect(diag?.proxy.requests).toHaveLength(1);
    expect(diag?.proxy.requests[0].status).toBe(200);
    expect(diag?.proxy.requests[0].bytes).toBe(12345);
    // URL should be sanitized (no query params)
    expect(diag?.proxy.requests[0].url).not.toContain('secret');
  });

  it('records image load success and failure', () => {
    initDiagnostics(testRequestId);
    recordImageLoad(testRequestId, 'https://images.example.com/photo1.jpg', true);
    recordImageLoad(testRequestId, 'https://images.example.com/photo2.jpg', false);
    const diag = getDiagnostics(testRequestId);
    expect(diag?.imageLoads.success).toHaveLength(1);
    expect(diag?.imageLoads.failed).toHaveLength(1);
  });

  it('clears diagnostics', () => {
    initDiagnostics(testRequestId);
    expect(getDiagnostics(testRequestId)).toBeDefined();
    clearDiagnostics(testRequestId);
    expect(getDiagnostics(testRequestId)).toBeNull();
  });
});
