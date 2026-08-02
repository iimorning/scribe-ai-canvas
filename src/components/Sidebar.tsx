import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  BookOpen,
  Library,
  Microscope,
  Bot,
  Camera,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userAvatar: string;
  setUserAvatar: (avatar: string) => void;
  userName: string;
  setUserName: (name: string) => void;
  userRole: string;
  setUserRole: (role: string) => void;
  setIsSettingsOpen: (open: boolean) => void;
}

export function Sidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  activeTab,
  setActiveTab,
  userAvatar,
  setUserAvatar,
  userName,
  setUserName,
  userRole,
  setUserRole,
  setIsSettingsOpen,
}: SidebarProps) {
  const { t } = useTranslation();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isLogoAvatar = userAvatar.includes('LOGO');

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setUserAvatar(event.target.result as string);
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  return (
    <aside className={`hidden md:flex flex-col py-6 space-y-2 bg-[#F4F1ED] h-full min-h-0 shrink-0 border-r border-[#E6E4DF] transition-all duration-300 overflow-y-auto scrollbar-hide ${isSidebarOpen ? 'w-36' : 'w-16 items-center'}`}>

      <div className="mb-6 px-3">
        <div className={`flex flex-col ${isSidebarOpen ? 'items-start' : 'items-center'} gap-2`}>
          <div className="flex items-center gap-3 w-full group relative">
            <input 
              type="file" 
              ref={avatarInputRef} 
              onChange={handleAvatarChange} 
              accept="image/*" 
              className="hidden" 
            />
            <div 
              onClick={() => avatarInputRef.current?.click()}
              className={`relative cursor-pointer group/avatar flex-shrink-0 flex items-center justify-center overflow-hidden rounded ${isSidebarOpen ? 'w-6' : 'w-8'}`}
            >
              <img 
                alt="Curator Profile" 
                className={`rounded border-2 border-[#E6E4DF] object-cover shadow-sm transition-all group-hover/avatar:opacity-80 ${isLogoAvatar ? 'scale-[1.45]' : ''} ${isSidebarOpen ? 'w-6 h-6' : 'w-8 h-8'}`} 
                src={userAvatar}
              />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity bg-black/20 rounded">
                <Camera className="w-3 h-3 text-white" />
              </div>
            </div>
            {isSidebarOpen && (
              <p 
                contentEditable 
                suppressContentEditableWarning
                onBlur={(e) => setUserName(e.currentTarget.innerText)}
                className="text-base font-bold whitespace-nowrap tracking-tight outline-none hover:bg-[#EAE7E2]/50 rounded px-1 -mx-1 transition-colors cursor-text overflow-hidden text-ellipsis"
              >
                {userName}
              </p>
            )}
          </div>
          {isSidebarOpen && (
            <p 
              contentEditable 
              suppressContentEditableWarning
              onBlur={(e) => setUserRole(e.currentTarget.innerText)}
              className="text-[10px] font-sans uppercase tracking-widest text-[#8c8a84] whitespace-nowrap outline-none hover:bg-[#EAE7E2]/50 rounded px-1 -mx-1 transition-colors cursor-text"
            >
              {userRole}
            </p>
          )}
        </div>
      </div>
      <nav className="flex flex-col font-sans text-sm w-full">
        <a onClick={(e) => { e.preventDefault(); setActiveTab('personal'); }} className={`cursor-pointer flex items-center min-w-0 ${isSidebarOpen ? 'gap-2 px-3' : 'justify-center'} py-2 ${activeTab === 'personal' ? 'bg-white border-y border-[#E6E4DF] text-[#C2410C]' : 'text-[#5a5a54] hover:bg-[#EAE7E2] transition-colors'}`}>
          <BookOpen className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span className="truncate">{t('sidebar.personal')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('reference'); }} className={`cursor-pointer flex items-center min-w-0 ${isSidebarOpen ? 'gap-2 px-3' : 'justify-center'} py-2 ${activeTab === 'reference' ? 'bg-white border-y border-[#E6E4DF] text-[#C2410C]' : 'text-[#5a5a54] hover:bg-[#EAE7E2] transition-colors'}`}>
          <Library className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span className="truncate">{t('sidebar.reference')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('lab'); }} className={`cursor-pointer flex items-center min-w-0 ${isSidebarOpen ? 'gap-2 px-3' : 'justify-center'} py-2 ${activeTab === 'lab' ? 'bg-white border-y border-[#E6E4DF] text-[#C2410C]' : 'text-[#5a5a54] hover:bg-[#EAE7E2] transition-colors'}`}>
          <Microscope className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span className="truncate">{t('sidebar.lab')}</span>}
        </a>
        <a onClick={(e) => { e.preventDefault(); setActiveTab('agents'); }} className={`cursor-pointer flex items-center min-w-0 ${isSidebarOpen ? 'gap-2 px-3' : 'justify-center'} py-2 ${activeTab === 'agents' ? 'bg-white border-y border-[#E6E4DF] text-[#C2410C]' : 'text-[#5a5a54] hover:bg-[#EAE7E2] transition-colors'}`}>
          <Bot className="w-4 h-4 flex-shrink-0" />
          {isSidebarOpen && <span className="truncate">{t('sidebar.agents')}</span>}
        </a>
      </nav>
      <div className="mt-auto px-3 pb-4 w-full flex flex-col gap-1">
        <button 
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsSidebarOpen(!isSidebarOpen); }}
          className={`w-full flex items-center ${isSidebarOpen ? 'gap-2' : 'justify-center'} py-2 text-[#8c8a84] hover:text-[#1a1a1a] hover:bg-[#EAE7E2] transition-colors rounded-lg group/toggle`}
        >
          <div className={`flex items-center justify-center ${isSidebarOpen ? 'w-6' : 'w-8'}`}>
            {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5 transition-transform group-hover/toggle:translate-x-0.5" />}
          </div>
        </button>
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className={`w-full flex items-center ${isSidebarOpen ? 'gap-2' : 'justify-center'} py-2 text-[#5a5a54] hover:bg-[#EAE7E2] transition-colors rounded-lg group/settings`}
          title={t('sidebar.settings')}
        >
          <div className={`flex items-center justify-center ${isSidebarOpen ? 'w-6' : 'w-8'}`}>
            <Settings className={`w-4 h-4 flex-shrink-0 transition-transform group-hover/settings:rotate-45`} />
          </div>
        </button>
      </div>
    </aside>
  );
}
