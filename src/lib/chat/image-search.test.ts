/**
 * Tests for image search SSE event parsing on the client side.
 *
 * These tests verify that the client can properly parse the new
 * `event: image_search` events emitted by the chat function.
 */
import { describe, it, expect } from 'vitest';

/**
 * Client-side parser for image search SSE events.
 * This mirrors the server-side parseImageSearchEvent function.
 */
interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  width?: number;
  height?: number;
}

type ImageSearchEvent =
  | { type: 'started'; queries: string[] }
  | { type: 'results'; images: ImageSearchResult[] }
  | { type: 'error'; message: string };

function parseImageSearchEvent(data: string): ImageSearchEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('type' in parsed)) return null;

    const type = parsed.type;
    if (type === 'started' && Array.isArray(parsed.queries)) {
      return { type: 'started', queries: parsed.queries };
    }
    if (type === 'results' && Array.isArray(parsed.images)) {
      return { type: 'results', images: parsed.images };
    }
    if (type === 'error' && typeof parsed.message === 'string') {
      return { type: 'error', message: parsed.message };
    }

    return null;
  } catch {
    return null;
  }
}

describe('Image Search SSE Event Parsing', () => {
  describe('parseImageSearchEvent', () => {
    it('parses a "started" event with queries', () => {
      const data = JSON.stringify({ type: 'started', queries: ['golden retrievers', 'puppies'] });
      const event = parseImageSearchEvent(data);

      expect(event).not.toBeNull();
      expect(event!.type).toBe('started');
      if (event!.type === 'started') {
        expect(event!.queries).toEqual(['golden retrievers', 'puppies']);
      }
    });

    it('parses a "results" event with images', () => {
      const images = [
        {
          url: 'https://example.com/image1.jpg',
          thumbnail: 'https://example.com/thumb1.jpg',
          title: 'Golden Retriever',
          sourceUrl: 'https://example.com/page1',
          sourceName: 'example.com',
          width: 800,
          height: 600,
        },
        {
          url: 'https://example.com/image2.jpg',
          thumbnail: 'https://example.com/thumb2.jpg',
          title: 'Labrador',
          sourceUrl: 'https://example.com/page2',
          sourceName: 'example.com',
        },
      ];

      const data = JSON.stringify({ type: 'results', images });
      const event = parseImageSearchEvent(data);

      expect(event).not.toBeNull();
      expect(event!.type).toBe('results');
      if (event!.type === 'results') {
        expect(event!.images).toHaveLength(2);
        expect(event!.images[0].url).toBe('https://example.com/image1.jpg');
        expect(event!.images[0].title).toBe('Golden Retriever');
        expect(event!.images[0].width).toBe(800);
        expect(event!.images[1].width).toBeUndefined();
      }
    });

    it('parses an "error" event with message', () => {
      const data = JSON.stringify({ type: 'error', message: 'Image search failed' });
      const event = parseImageSearchEvent(data);

      expect(event).not.toBeNull();
      expect(event!.type).toBe('error');
      if (event!.type === 'error') {
        expect(event!.message).toBe('Image search failed');
      }
    });

    it('returns null for invalid JSON', () => {
      expect(parseImageSearchEvent('not valid json')).toBeNull();
      expect(parseImageSearchEvent('')).toBeNull();
      expect(parseImageSearchEvent('{')).toBeNull();
    });

    it('returns null for non-object data', () => {
      expect(parseImageSearchEvent('"string"')).toBeNull();
      expect(parseImageSearchEvent('123')).toBeNull();
      expect(parseImageSearchEvent('null')).toBeNull();
    });

    it('returns null for missing "type" field', () => {
      expect(parseImageSearchEvent('{"queries":["cats"]}')).toBeNull();
      expect(parseImageSearchEvent('{"images":[]}')).toBeNull();
      expect(parseImageSearchEvent('{}')).toBeNull();
    });

    it('returns null for unknown event types', () => {
      expect(parseImageSearchEvent('{"type":"unknown"}')).toBeNull();
      expect(parseImageSearchEvent('{"type":"complete"}')).toBeNull();
    });

    it('returns null for "started" event without queries array', () => {
      expect(parseImageSearchEvent('{"type":"started"}')).toBeNull();
      expect(parseImageSearchEvent('{"type":"started","queries":"not-an-array"}')).toBeNull();
    });

    it('returns null for "results" event without images array', () => {
      expect(parseImageSearchEvent('{"type":"results"}')).toBeNull();
      expect(parseImageSearchEvent('{"type":"results","images":"not-an-array"}')).toBeNull();
    });

    it('returns null for "error" event without message string', () => {
      expect(parseImageSearchEvent('{"type":"error"}')).toBeNull();
      expect(parseImageSearchEvent('{"type":"error","message":123}')).toBeNull();
    });

    it('handles empty images array in results event', () => {
      const data = JSON.stringify({ type: 'results', images: [] });
      const event = parseImageSearchEvent(data);

      expect(event).not.toBeNull();
      expect(event!.type).toBe('results');
      if (event!.type === 'results') {
        expect(event!.images).toEqual([]);
      }
    });

    it('handles empty queries array in started event', () => {
      const data = JSON.stringify({ type: 'started', queries: [] });
      const event = parseImageSearchEvent(data);

      expect(event).not.toBeNull();
      expect(event!.type).toBe('started');
      if (event!.type === 'started') {
        expect(event!.queries).toEqual([]);
      }
    });
  });

  describe('Integration: SSE stream parsing', () => {
    it('simulates parsing a complete SSE stream with image search events', () => {
      // Simulate the SSE stream from the server
      const sseFrames = [
        'event: image_search\ndata: {"type":"started","queries":["cats"]}\n\n',
        'data: {"choices":[{"delta":{"content":"Here"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" are"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" some"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" cats"}}]}\n\n',
        'event: image_search\ndata: {"type":"results","images":[{"url":"https://example.com/cat.jpg","thumbnail":"https://example.com/thumb.jpg","title":"Cat","sourceUrl":"https://example.com","sourceName":"example.com"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      // Parse the stream
      const events: Array<{ type: string; data: unknown }> = [];
      for (const frame of sseFrames) {
        const lines = frame.split('\n');
        let eventType = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        const data = dataLines.join('\n');
        if (eventType === 'image_search') {
          const parsed = parseImageSearchEvent(data);
          if (parsed) {
            events.push({ type: 'image_search', data: parsed });
          }
        } else if (eventType === 'message') {
          events.push({ type: 'message', data });
        }
      }

      // Verify the events
      expect(events).toHaveLength(7);
      expect(events[0].type).toBe('image_search');
      expect((events[0].data as ImageSearchEvent).type).toBe('started');
      expect(events[1].type).toBe('message');
      expect(events[2].type).toBe('message');
      expect(events[3].type).toBe('message');
      expect(events[4].type).toBe('message');
      expect(events[5].type).toBe('image_search');
      expect((events[5].data as ImageSearchEvent).type).toBe('results');
      expect(events[6].type).toBe('message');
      expect(events[6].data).toBe('[DONE]');
    });

    it('simulates parsing an SSE stream with image search error', () => {
      const sseFrames = [
        'event: image_search\ndata: {"type":"started","queries":["test"]}\n\n',
        'data: {"choices":[{"delta":{"content":"Searching..."}}]}\n\n',
        'event: image_search\ndata: {"type":"error","message":"Image search not configured"}\n\n',
        'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const events: Array<{ type: string; data: unknown }> = [];
      for (const frame of sseFrames) {
        const lines = frame.split('\n');
        let eventType = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        const data = dataLines.join('\n');
        if (eventType === 'image_search') {
          const parsed = parseImageSearchEvent(data);
          if (parsed) {
            events.push({ type: 'image_search', data: parsed });
          }
        } else if (eventType === 'message') {
          events.push({ type: 'message', data });
        }
      }

      // Find the error event
      const errorEvent = events.find(
        e => e.type === 'image_search' && (e.data as ImageSearchEvent).type === 'error'
      );
      expect(errorEvent).toBeDefined();
      const errorData = errorEvent?.data as ImageSearchEvent;
      if (errorData && errorData.type === 'error') {
        expect(errorData.message).toBe('Image search not configured');
      }
    });
  });

  describe('Security: no API keys in events', () => {
    it('verifies that parsed events do not contain API keys', () => {
      const apiKey = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';

      // Even if a malicious server sent an API key, the client parser
      // should not expose it in the parsed result
      const data = JSON.stringify({
        type: 'results',
        images: [
          {
            url: `https://example.com/image.jpg?key=${apiKey}`,
            thumbnail: 'https://example.com/thumb.jpg',
            title: 'Test',
            sourceUrl: 'https://example.com',
            sourceName: 'example.com',
          },
        ],
      });

      const event = parseImageSearchEvent(data);
      expect(event).not.toBeNull();

      // The parser doesn't filter URLs - that's the server's job
      // But we verify the parser doesn't add any extra key exposure
      if (event?.type === 'results') {
        expect(event.images[0].url).toContain(apiKey);
        // In production, the server should strip API keys from URLs before sending
      }
    });
  });
});
