import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { setLanguage } from '../../lib/i18n';
import { IconButton, ConfirmDialog, Spinner } from '.';

describe('UI primitives follow the interface language', () => {
  afterEach(() => act(() => setLanguage('en')));

  it('IconButton translates its accessible name', () => {
    act(() => setLanguage('hi'));
    render(<IconButton label="Collapse sidebar">x</IconButton>);
    expect(screen.getByRole('button', { name: 'साइडबार समेटें' })).toBeInTheDocument();
  });

  it('keeps unknown labels as written', () => {
    act(() => setLanguage('hi'));
    render(<IconButton label="Totally custom label">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Totally custom label' })).toBeInTheDocument();
  });

  it('ConfirmDialog title, buttons and close button are Hindi', () => {
    act(() => setLanguage('hi'));
    render(<ConfirmDialog open title="Delete this chat?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'यह चैट हटाएँ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'हटाएँ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'रद्द करें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'बंद करें' })).toBeInTheDocument();
  });

  it('Spinner has a Hindi status label and stays English by default', () => {
    const { unmount } = render(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    unmount();
    act(() => setLanguage('hi'));
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'लोड हो रहा है' })).toBeInTheDocument();
  });
});
