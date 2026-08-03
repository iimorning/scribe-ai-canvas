import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../../src/components/Sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('lucide-react', () => {
  const make = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    Settings: make('Settings'),
    BookOpen: make('BookOpen'),
    Library: make('Library'),
    Microscope: make('Microscope'),
    Bot: make('Bot'),
    Camera: make('Camera'),
    ChevronLeft: make('ChevronLeft'),
    ChevronRight: make('ChevronRight'),
  };
});

function makeProps(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return {
    isSidebarOpen: true,
    setIsSidebarOpen: vi.fn(),
    activeTab: 'personal',
    setActiveTab: vi.fn(),
    userAvatar: 'data:image/png;base64,AAAA',
    setUserAvatar: vi.fn(),
    userName: 'Alice',
    setUserName: vi.fn(),
    userRole: 'Curator',
    setUserRole: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const merged = makeProps(props);
  return { ...render(<Sidebar {...merged} />), props: merged };
}

describe('Sidebar', () => {
  describe('render basics (open/closed states)', () => {
    it('uses w-36 when open', () => {
      const { container } = renderSidebar({ isSidebarOpen: true });
      const aside = container.querySelector('aside')!;
      expect(aside.className).toContain('w-36');
      expect(aside.className).not.toContain('w-16');
    });

    it('uses w-16 and items-center when closed', () => {
      const { container } = renderSidebar({ isSidebarOpen: false });
      const aside = container.querySelector('aside')!;
      expect(aside.className).toContain('w-16');
      expect(aside.className).toContain('items-center');
      expect(aside.className).not.toContain('w-36');
    });

    it('renders without crashing with default props', () => {
      expect(() => renderSidebar()).not.toThrow();
    });

    it('shows nav tab labels when open', () => {
      renderSidebar({ isSidebarOpen: true });
      expect(screen.getByText('sidebar.personal')).toBeInTheDocument();
      expect(screen.getByText('sidebar.reference')).toBeInTheDocument();
      expect(screen.getByText('sidebar.lab')).toBeInTheDocument();
      expect(screen.getByText('sidebar.agents')).toBeInTheDocument();
    });

    it('hides nav tab labels when closed (icon only)', () => {
      renderSidebar({ isSidebarOpen: false });
      expect(screen.queryByText('sidebar.personal')).not.toBeInTheDocument();
      expect(screen.queryByText('sidebar.reference')).not.toBeInTheDocument();
    });
  });

  describe('avatar', () => {
    it('renders a hidden file input with accept="image/*"', () => {
      const { container } = renderSidebar();
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute('accept', 'image/*');
      expect(input).toHaveClass('hidden');
    });

    it('renders the avatar image with the userAvatar src', () => {
      renderSidebar({ userAvatar: 'data:image/png;base64,XYZ' });
      const img = screen.getByAltText('Curator Profile') as HTMLImageElement;
      expect(img.src).toBe('data:image/png;base64,XYZ');
    });

    it('applies scale-[1.45] when userAvatar contains "LOGO"', () => {
      renderSidebar({ userAvatar: 'LOGO.png' });
      const img = screen.getByAltText('Curator Profile');
      expect(img.className).toContain('scale-[1.45]');
    });

    it('does NOT apply scale-[1.45] for non-LOGO avatars', () => {
      renderSidebar({ userAvatar: 'avatar.png' });
      const img = screen.getByAltText('Curator Profile');
      expect(img.className).not.toContain('scale-[1.45]');
    });

    it('clicking the avatar wrapper triggers the hidden file input click', () => {
      const { container } = renderSidebar();
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, 'click');
      // The avatar wrapper is the div wrapping the img + the overlay
      const avatarWrapper = screen.getByAltText('Curator Profile').parentElement!;
      fireEvent.click(avatarWrapper);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('uploading a file calls FileReader.readAsDataURL and propagates the result to setUserAvatar', async () => {
      const user = userEvent.setup();
      const setUserAvatar = vi.fn();
      const { container } = renderSidebar({ setUserAvatar });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      // Override FileReader for this test: capture the onload handler
      let capturedOnload: ((e: { target: { result: string } }) => void) | null = null;
      const OriginalFileReader = globalThis.FileReader;
      class MockFileReader {
        onload: ((e: { target: { result: string } }) => void) | null = null;
        readAsDataURL = vi.fn(function (this: MockFileReader) {
          capturedOnload = this.onload;
        });
      }
      // @ts-expect-error — stub
      globalThis.FileReader = MockFileReader;
      try {
        const file = new File(['hello'], 'avatar.png', { type: 'image/png' });
        await user.upload(input, file);
        // readAsDataURL should have been called and stored the onload
        expect(capturedOnload).not.toBeNull();
        // Trigger the onload
        capturedOnload!({ target: { result: 'data:image/png;base64,AAAA' } });
        expect(setUserAvatar).toHaveBeenCalledWith('data:image/png;base64,AAAA');
      } finally {
        globalThis.FileReader = OriginalFileReader;
      }
    });

    it('uploading with no file does not call setUserAvatar', async () => {
      const setUserAvatar = vi.fn();
      const { container } = renderSidebar({ setUserAvatar });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      // Fire change with no files
      fireEvent.change(input, { target: { files: null } });
      expect(setUserAvatar).not.toHaveBeenCalled();
    });
  });

  describe('contentEditable name and role', () => {
    it('renders the userName and userRole paragraphs as contentEditable when open', () => {
      const { container } = renderSidebar({ userName: 'Alice', userRole: 'Curator' });
      const editables = container.querySelectorAll('p[contenteditable]');
      expect(editables.length).toBe(2);
      expect(editables[0].textContent).toBe('Alice');
      expect(editables[1].textContent).toBe('Curator');
    });

    it('does NOT render the contentEditable name/role when closed', () => {
      const { container } = renderSidebar({ isSidebarOpen: false, userName: 'Alice', userRole: 'Curator' });
      const editables = container.querySelectorAll('p[contenteditable]');
      expect(editables.length).toBe(0);
    });

    it('onBlur on the name paragraph calls setUserName with the new innerText', () => {
      const setUserName = vi.fn();
      const { container } = renderSidebar({ setUserName });
      const nameEl = container.querySelector('p[contenteditable]')!;
      // Simulate the user editing: replace innerText, then blur
      Object.defineProperty(nameEl, 'innerText', { value: 'Bob', configurable: true });
      fireEvent.blur(nameEl);
      expect(setUserName).toHaveBeenCalledWith('Bob');
    });

    it('onBlur on the role paragraph calls setUserRole with the new innerText', () => {
      const setUserRole = vi.fn();
      const { container } = renderSidebar({ setUserRole });
      const editables = container.querySelectorAll('p[contenteditable]');
      const roleEl = editables[1]!;
      Object.defineProperty(roleEl, 'innerText', { value: 'Editor', configurable: true });
      fireEvent.blur(roleEl);
      expect(setUserRole).toHaveBeenCalledWith('Editor');
    });
  });

  describe('navigation tabs', () => {
    it('renders 4 nav links for personal/reference/lab/agents', () => {
      const { container } = renderSidebar();
      const navLinks = container.querySelectorAll('nav a');
      expect(navLinks.length).toBe(4);
    });

    it('clicking the personal tab calls setActiveTab("personal") and preventDefault', () => {
      const setActiveTab = vi.fn();
      const { container } = renderSidebar({ setActiveTab });
      const personalLink = container.querySelectorAll('nav a')[0]!;
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      personalLink.dispatchEvent(evt);
      expect(setActiveTab).toHaveBeenCalledWith('personal');
      expect(evt.defaultPrevented).toBe(true);
    });

    it('clicking the reference tab calls setActiveTab("reference")', () => {
      const setActiveTab = vi.fn();
      const { container } = renderSidebar({ setActiveTab });
      container.querySelectorAll('nav a')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setActiveTab).toHaveBeenCalledWith('reference');
    });

    it('clicking the lab tab calls setActiveTab("lab")', () => {
      const setActiveTab = vi.fn();
      const { container } = renderSidebar({ setActiveTab });
      container.querySelectorAll('nav a')[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setActiveTab).toHaveBeenCalledWith('lab');
    });

    it('clicking the agents tab calls setActiveTab("agents")', () => {
      const setActiveTab = vi.fn();
      const { container } = renderSidebar({ setActiveTab });
      container.querySelectorAll('nav a')[3]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setActiveTab).toHaveBeenCalledWith('agents');
    });

    it('applies the active style (bg-white border-y text-[#C2410C]) to the active tab', () => {
      const { container } = renderSidebar({ activeTab: 'reference' });
      const links = container.querySelectorAll('nav a');
      expect(links[1]!.className).toContain('bg-white');
      expect(links[1]!.className).toContain('text-[#C2410C]');
      // Other tabs should not have the active class
      expect(links[0]!.className).not.toContain('text-[#C2410C]');
      expect(links[2]!.className).not.toContain('text-[#C2410C]');
    });

    it('applies the active style to the lab tab when activeTab="lab"', () => {
      const { container } = renderSidebar({ activeTab: 'lab' });
      const links = container.querySelectorAll('nav a');
      expect(links[2]!.className).toContain('text-[#C2410C]');
    });

    it('applies the active style to the agents tab when activeTab="agents"', () => {
      const { container } = renderSidebar({ activeTab: 'agents' });
      const links = container.querySelectorAll('nav a');
      expect(links[3]!.className).toContain('text-[#C2410C]');
    });

    it('shows the correct icon for each tab', () => {
      renderSidebar();
      expect(screen.getByTestId('icon-BookOpen')).toBeInTheDocument();
      expect(screen.getByTestId('icon-Library')).toBeInTheDocument();
      expect(screen.getByTestId('icon-Microscope')).toBeInTheDocument();
      expect(screen.getByTestId('icon-Bot')).toBeInTheDocument();
    });
  });

  describe('bottom buttons', () => {
    it('shows ChevronLeft when isSidebarOpen=true', () => {
      renderSidebar({ isSidebarOpen: true });
      expect(screen.getByTestId('icon-ChevronLeft')).toBeInTheDocument();
      expect(screen.queryByTestId('icon-ChevronRight')).not.toBeInTheDocument();
    });

    it('shows ChevronRight when isSidebarOpen=false', () => {
      renderSidebar({ isSidebarOpen: false });
      expect(screen.getByTestId('icon-ChevronRight')).toBeInTheDocument();
      expect(screen.queryByTestId('icon-ChevronLeft')).not.toBeInTheDocument();
    });

    it('clicking the toggle button calls setIsSidebarOpen(!isSidebarOpen) when open', () => {
      const setIsSidebarOpen = vi.fn();
      const { container } = renderSidebar({ isSidebarOpen: true, setIsSidebarOpen });
      // First button at the bottom is the toggle
      const toggleBtn = container.querySelectorAll('button')[0]!;
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      toggleBtn.dispatchEvent(evt);
      expect(setIsSidebarOpen).toHaveBeenCalledWith(false);
      expect(evt.defaultPrevented).toBe(true);
    });

    it('clicking the toggle button calls setIsSidebarOpen(!isSidebarOpen) when closed', () => {
      const setIsSidebarOpen = vi.fn();
      const { container } = renderSidebar({ isSidebarOpen: false, setIsSidebarOpen });
      const toggleBtn = container.querySelectorAll('button')[0]!;
      toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setIsSidebarOpen).toHaveBeenCalledWith(true);
    });

    it('toggle button click preventDefault is called (the component uses e.preventDefault to prevent nav)', () => {
      const { container } = renderSidebar();
      const toggleBtn = container.querySelectorAll('button')[0]!;
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      toggleBtn.dispatchEvent(evt);
      // The component's onClick is `(e) => { e.preventDefault(); e.stopPropagation(); setIsSidebarOpen(...) }`
      // — so the synthetic event should be both prevented and stopped.
      expect(evt.defaultPrevented).toBe(true);
    });

    it('clicking the settings button calls setIsSettingsOpen(true)', () => {
      const setIsSettingsOpen = vi.fn();
      const { container } = renderSidebar({ setIsSettingsOpen });
      // Second button is the settings button
      const settingsBtn = container.querySelectorAll('button')[1]!;
      settingsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setIsSettingsOpen).toHaveBeenCalledWith(true);
    });

    it('settings button has the i18n title attribute', () => {
      const { container } = renderSidebar();
      const settingsBtn = container.querySelectorAll('button')[1]!;
      expect(settingsBtn).toHaveAttribute('title', 'sidebar.settings');
    });
  });
});
