/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Expand,
  ExternalLink,
  FileBadge2,
  Globe,
  Mail,
  MapPin,
  Phone,
  Presentation,
  Shield,
  Target,
  TrendingUp,
  Users,
  UserSquare2,
  X,
} from 'lucide-react';

type AssetKind = 'image' | 'pdf' | 'html';

interface AssetDefinition {
  kind: AssetKind;
  title: string;
  description: string;
  src: string;
  previewSrc?: string;
  badge: string;
}

interface ExpandedAsset extends AssetDefinition {}

interface SlideDefinition {
  title: string;
  content: React.ReactNode;
}

const assetPath = (fileName: string) => `${import.meta.env.BASE_URL}presentation-assets/${fileName}`;

const assets = {
  rotation: {
    kind: 'html',
    title: 'Guard Rotation Tool',
    description:
      'Used by a supervisor to show where guards go throughout the day and to keep site coverage organized in real time.',
    src: assetPath('rotation.html'),
    badge: 'Supervisor Tool',
  },
  scheduler: {
    kind: 'html',
    title: 'Shift Scheduler',
    description:
      'Used to schedule every shift so each officer knows when they are supposed to work for the day and week ahead.',
    src: assetPath('scheduler.html'),
    badge: 'Staffing Tool',
  },
  monthlyMeeting: {
    kind: 'image',
    title: 'Monthly Staff Meeting',
    description:
      'A monthly meeting used to catch the team up on current issues, new information, and backend updates that affected staff during that month.',
    src: assetPath('monthly-meeting.png'),
    badge: 'Communication',
  },
  allHands: {
    kind: 'image',
    title: 'All Hands-In Meeting',
    description:
      'A larger all-hands meeting held about every six months so all shifts could come together, align on operations, and review major updates.',
    src: assetPath('all-hands-in-meeting.png'),
    badge: 'Team Alignment',
  },
  interviewSheet: {
    kind: 'image',
    title: 'Interview Sheet',
    description:
      'An interview review sheet used during hiring so candidate details can be seen clearly and discussed during the hiring process.',
    src: assetPath('interview-sheet.png'),
    badge: 'Hiring',
  },
  profilePhoto: {
    kind: 'image',
    title: 'Tyrese Hawthorne',
    description:
      'Professional profile photo included directly in the presentation to personalize the account manager story and leadership profile.',
    src: assetPath('tyrese-profile-pic.png'),
    badge: 'Profile',
  },
  cprCertificate: {
    kind: 'pdf',
    title: 'CPR Certification',
    description:
      'Visible preview of the CPR certification with the full PDF available to open during the presentation when a closer look is needed.',
    src: assetPath('cpr-certification.pdf'),
    previewSrc: assetPath('cpr-certification-preview.png'),
    badge: 'Certification',
  },
} satisfies Record<string, AssetDefinition>;

const ProgressBar = ({ current, total }: { current: number; total: number }) => (
  <div className="fixed top-0 left-0 z-50 h-1 w-full bg-white/10">
    <motion.div
      className="h-full bg-ispa-blue"
      initial={{ width: 0 }}
      animate={{ width: `${((current + 1) / total) * 100}%` }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
    />
  </div>
);

const Navigation = ({
  current,
  total,
  onPrev,
  onNext,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) => (
  <div className="fixed bottom-6 left-0 z-50 flex w-full items-center justify-between px-4 md:bottom-8 md:px-8">
    <div className="flex gap-4">
      <button
        onClick={onPrev}
        disabled={current === 0}
        className="glass rounded-full p-3 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={onNext}
        disabled={current === total - 1}
        className="glass rounded-full p-3 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Next slide"
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </div>

    <div className="font-display text-sm tracking-widest opacity-60">
      {String(current + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
    </div>

    <div className="hidden items-center gap-6 text-xs uppercase tracking-widest opacity-40 md:flex">
      <div className="flex items-center gap-2">
        <Shield className="h-3 w-3" />
        ISPA Security
      </div>
      <div className="flex items-center gap-2">
        <Briefcase className="h-3 w-3" />
        Account Manager
      </div>
    </div>
  </div>
);

const SlideWrapper = ({
  children,
  direction,
}: {
  children: React.ReactNode;
  direction: number;
}) => (
  <motion.div
    initial={{ x: direction > 0 ? '100%' : '-100%', opacity: 0 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: direction > 0 ? '-100%' : '100%', opacity: 0 }}
    transition={{ type: 'spring', damping: 24, stiffness: 115 }}
    className="slide-container"
  >
    {children}
  </motion.div>
);

const SectionHeading = ({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) => (
  <div className="space-y-3">
    <p className="text-sm font-semibold uppercase tracking-[0.35em] text-ispa-blue">{eyebrow}</p>
    <h2 className="text-4xl md:text-5xl">{title}</h2>
    <p className="max-w-2xl text-base leading-relaxed text-slate-300 md:text-lg">{body}</p>
  </div>
);

const ActionLink = ({
  href,
  label,
  filled = false,
}: {
  href: string;
  label: string;
  filled?: boolean;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
      filled
        ? 'bg-ispa-blue text-white hover:bg-ispa-blue/80'
        : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'
    }`}
  >
    {label}
    <ExternalLink className="h-4 w-4" />
  </a>
);

const MediaCard = ({
  asset,
  onExpand,
  livePreview = false,
}: {
  asset: AssetDefinition;
  onExpand: (asset: AssetDefinition) => void;
  livePreview?: boolean;
}) => {
  const preview = asset.kind === 'pdf' ? asset.previewSrc : asset.src;

  return (
    <motion.article
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass flex h-full flex-col overflow-hidden rounded-[2rem]"
    >
      <div
        className={`relative ${livePreview ? 'h-[280px] md:h-[320px]' : 'h-[260px]'} overflow-hidden bg-slate-950`}
      >
        {asset.kind === 'html' ? (
          <>
            <iframe
              src={asset.src}
              title={asset.title}
              className="h-full w-full scale-[0.78] origin-top-left pointer-events-none border-0"
              style={{ width: '128%', height: '128%' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ispa-navy via-transparent to-transparent" />
            <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white/80">
              Live Tool Preview
            </div>
          </>
        ) : (
          <img src={preview} alt={asset.title} className="h-full w-full object-cover object-top" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="space-y-3">
          <div className="inline-flex w-fit rounded-full bg-ispa-orange/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-ispa-orange">
            {asset.badge}
          </div>
          <div>
            <h3 className="text-2xl font-display">{asset.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{asset.description}</p>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap gap-3">
          <button
            onClick={() => onExpand(asset)}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-white/10"
          >
            <Expand className="h-4 w-4" />
            Expand
          </button>
          <ActionLink href={asset.src} label={asset.kind === 'pdf' ? 'Open PDF' : 'Open File'} filled />
        </div>
      </div>
    </motion.article>
  );
};

const ExpandedAssetModal = ({
  asset,
  onClose,
}: {
  asset: ExpandedAsset | null;
  onClose: () => void;
}) => (
  <AnimatePresence>
    {asset ? (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 24, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.97 }}
          transition={{ type: 'spring', damping: 22, stiffness: 180 }}
          className="glass relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-8">
            <div className="space-y-2">
              <div className="inline-flex rounded-full bg-ispa-blue/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-ispa-blue">
                {asset.badge}
              </div>
              <div>
                <h3 className="text-2xl font-display md:text-3xl">{asset.title}</h3>
                <p className="max-w-3xl text-sm leading-relaxed text-slate-300 md:text-base">{asset.description}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 bg-slate-950/70 p-4 md:p-6">
            {asset.kind === 'image' ? (
              <div className="h-full overflow-auto rounded-[1.5rem] bg-slate-950 p-2">
                <img src={asset.src} alt={asset.title} className="mx-auto h-auto max-w-full rounded-[1.25rem]" />
              </div>
            ) : (
              <iframe
                src={asset.src}
                title={asset.title}
                className="h-[65vh] w-full rounded-[1.5rem] border border-white/10 bg-white"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-4 md:px-8">
            <p className="text-sm text-slate-400">
              Click outside this window or press <span className="font-semibold text-slate-200">Esc</span> to close.
            </p>
            <ActionLink href={asset.src} label={asset.kind === 'pdf' ? 'Open Full PDF' : 'Open Original'} filled />
          </div>
        </motion.div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);

const TitleSlide = () => (
  <div className="mx-auto max-w-5xl space-y-10 px-6 text-center">
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="flex justify-center"
    >
      <img
        src="/ispa-logo.png"
        alt="ISPA Logo"
        className="h-20 object-contain md:h-28"
        onError={(event) => {
          event.currentTarget.src = 'https://storage.googleapis.com/aistudio-build-assets/ispa-logo-white.png';
        }}
        referrerPolicy="no-referrer"
      />
    </motion.div>

    <div className="space-y-4">
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-5xl font-display font-bold leading-tight md:text-8xl"
      >
        Account Manager <span className="text-ispa-blue">Presentation</span>
      </motion.h1>
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mx-auto max-w-3xl text-lg font-light tracking-wide text-slate-300 md:text-2xl"
      >
        A visual walkthrough of leadership tools, staffing workflows, communication rhythms, and operational support materials.
      </motion.p>
    </div>

    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.55 }}
      className="flex flex-wrap items-center justify-center gap-3"
    >
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm uppercase tracking-[0.25em] text-slate-200">
        Tyrese Hawthorne
      </div>
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm uppercase tracking-[0.25em] text-slate-200">
        ISPA Security Services
      </div>
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm uppercase tracking-[0.25em] text-slate-200">
        April 8, 2026
      </div>
    </motion.div>

    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.7 }}
      className="mx-auto grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-3"
    >
      {[
        { icon: CalendarDays, label: 'Scheduling', text: 'Shift coverage, rotation planning, and visibility for supervisors.' },
        { icon: Users, label: 'Staffing', text: 'Interview support, team updates, and communication touchpoints.' },
        { icon: FileBadge2, label: 'Credentials', text: 'Profile and certification materials ready to open live during the presentation.' },
      ].map((item) => (
        <div key={item.label} className="glass rounded-[1.5rem] p-5 text-left">
          <item.icon className="mb-4 h-7 w-7 text-ispa-blue" />
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-ispa-orange">{item.label}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
        </div>
      ))}
    </motion.div>
  </div>
);

const ProfileSlide = () => (
  <div className="content-grid items-center">
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Professional Profile"
        title="Leadership Presence With Operational Range"
        body="This presentation combines the tools and documents I use across staffing, scheduling, communication, and field supervision. The goal is to show not only experience, but how I organize work and keep teams aligned."
      />

      <div className="space-y-4">
        {[
          'Managed high-visibility security operations with a focus on consistency, accountability, and client-facing professionalism.',
          'Used practical digital tools to turn repetitive work into simple, repeatable clicks for supervisors and staff.',
          'Built communication habits that kept officers informed through monthly meetings, all-hands alignment sessions, and clearer scheduling visibility.',
        ].map((item) => (
          <div key={item} className="flex items-start gap-4">
            <div className="mt-1 rounded-full bg-ispa-blue/20 p-1.5">
              <CheckCircle2 className="h-4 w-4 text-ispa-blue" />
            </div>
            <p className="text-sm leading-relaxed text-slate-300 md:text-base">{item}</p>
          </div>
        ))}
      </div>

      <div className="glass rounded-[1.75rem] border-l-4 border-ispa-orange p-6">
        <p className="text-sm uppercase tracking-[0.3em] text-ispa-orange">Presentation Focus</p>
        <p className="mt-3 text-lg leading-relaxed text-slate-200">
          Showing the tools, documents, and meeting materials behind day-to-day account management.
        </p>
      </div>
    </div>

    <div className="flex items-center justify-center">
      <div className="glass relative w-full max-w-md overflow-hidden rounded-[2rem]">
        <img
          src={assets.profilePhoto.src}
          alt="Tyrese Hawthorne"
          className="aspect-[4/5] w-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ispa-navy via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <div className="inline-flex rounded-full bg-ispa-blue/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-ispa-blue">
            {assets.profilePhoto.badge}
          </div>
          <h3 className="mt-3 text-3xl font-display">Tyrese Hawthorne</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Account manager candidate focused on organized operations, stronger communication, and scalable team support.
          </p>
        </div>
      </div>
    </div>
  </div>
);

const OperationsSlide = ({ onExpand }: { onExpand: (asset: AssetDefinition) => void }) => (
  <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-8 px-6 pb-20 pt-12 md:px-8">
    <SectionHeading
      eyebrow="Operations Tools"
      title="Rotation And Scheduling Tools Used In The Field"
      body="These are the actual tools used to manage coverage and staffing. Both are built into the presentation so they can be opened live whenever you want to walk through the workflow in more detail."
    />

    <div className="grid flex-1 grid-cols-1 gap-6 xl:grid-cols-2">
      <MediaCard asset={assets.rotation} onExpand={onExpand} livePreview />
      <MediaCard asset={assets.scheduler} onExpand={onExpand} livePreview />
    </div>
  </div>
);

const CommunicationSlide = ({ onExpand }: { onExpand: (asset: AssetDefinition) => void }) => (
  <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-8 px-6 pb-20 pt-12 md:px-8">
    <SectionHeading
      eyebrow="Team Communication"
      title="Meeting Visuals That Kept The Team Updated"
      body="These visuals support how information was delivered to staff. Monthly meetings handled current updates and operational news, while the all-hands meeting brought every shift together for broader alignment."
    />

    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <MediaCard asset={assets.monthlyMeeting} onExpand={onExpand} />
      <MediaCard asset={assets.allHands} onExpand={onExpand} />
    </div>
  </div>
);

const HiringAndComplianceSlide = ({ onExpand }: { onExpand: (asset: AssetDefinition) => void }) => (
  <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-8 px-6 pb-20 pt-12 md:px-8">
    <SectionHeading
      eyebrow="Hiring And Compliance"
      title="Interview And Certification Materials Ready To Open"
      body="The interview sheet is visible directly in the presentation and can be expanded for a closer look. The CPR certification also shows as a visual preview while still linking to the full PDF."
    />

    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <div onDoubleClick={() => onExpand(assets.interviewSheet)} className="h-full">
        <MediaCard asset={assets.interviewSheet} onExpand={onExpand} />
      </div>
      <MediaCard asset={assets.cprCertificate} onExpand={onExpand} />
    </div>
  </div>
);

const ToolkitSlide = () => (
  <div className="content-grid items-center">
    <div className="grid grid-cols-2 gap-4">
      {[
        { icon: Shield, label: 'Site Coverage' },
        { icon: CalendarDays, label: 'Shift Planning' },
        { icon: Presentation, label: 'Team Meetings' },
        { icon: UserSquare2, label: 'Interview Support' },
      ].map((item) => (
        <motion.div
          key={item.label}
          initial={{ scale: 0.84, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass aspect-square rounded-[2rem] p-6"
        >
          <item.icon className="h-10 w-10 text-ispa-blue" />
          <div className="mt-10">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-ispa-orange">{item.label}</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Practical tools and processes that support reliable staffing, communication, and post accountability.
            </p>
          </div>
        </motion.div>
      ))}
    </div>

    <div className="space-y-8">
      <SectionHeading
        eyebrow="Account Manager Toolkit"
        title="Operational Systems Backed By Real Documents"
        body="The presentation is not just talking points. It includes the actual materials used to schedule people, communicate updates, document interviews, and show qualifications in a way that can be opened on demand."
      />

      <div className="space-y-5">
        {[
          {
            title: 'Supervisor Visibility',
            description: 'The rotation board makes it easier to explain where guards should go throughout the day and how coverage moves across the shift.',
            icon: Clock3,
          },
          {
            title: 'Staff Scheduling',
            description: 'The scheduler gives staff a clearer view of when they are expected to work, reducing confusion and helping shift leaders plan coverage.',
            icon: CalendarDays,
          },
          {
            title: 'Team Communication',
            description: 'Meeting visuals give staff a clean way to digest changes, updates, and operational priorities across the month and across all shifts.',
            icon: Users,
          },
          {
            title: 'Prepared Documentation',
            description: 'Supporting documents like the interview sheet and CPR certification are presentation-ready and available for closer review when needed.',
            icon: FileBadge2,
          },
        ].map((item) => (
          <div key={item.title} className="glass rounded-[1.5rem] border-l-4 border-ispa-blue p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-ispa-blue/15 p-3">
                <item.icon className="h-5 w-5 text-ispa-blue" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const GrowthSlide = () => (
  <div className="mx-auto w-full max-w-6xl space-y-12 px-6">
    <div className="space-y-4 text-center">
      <h2 className="text-5xl">Proven Impact</h2>
      <p className="mx-auto max-w-2xl text-slate-400">
        The value behind these materials is their ability to make operations more visible, more repeatable, and easier for teams to follow.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      {[
        {
          title: 'Efficiency',
          value: '35%',
          description: 'Reduction in paperwork time by converting repetitive workflows into simpler digital actions.',
          icon: TrendingUp,
        },
        {
          title: 'Accountability',
          value: '24/7',
          description: 'Tools and meeting rhythms built to support around-the-clock coverage and clear expectations.',
          icon: Target,
        },
        {
          title: 'Leadership',
          value: '31',
          description: 'Security officers supported in a high-stakes environment where scheduling and communication mattered daily.',
          icon: Users,
        },
      ].map((item) => (
        <motion.div
          key={item.title}
          initial={{ y: 28, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass rounded-[2rem] p-8 text-center"
        >
          <item.icon className="mx-auto h-10 w-10 text-ispa-blue" />
          <div className="mt-6">
            <div className="text-5xl font-display font-bold text-white">{item.value}</div>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.35em] text-ispa-orange">{item.title}</p>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">{item.description}</p>
        </motion.div>
      ))}
    </div>
  </div>
);

const RoadmapSlide = () => (
  <div className="content-grid items-center">
    <div className="space-y-8">
      <SectionHeading
        eyebrow="30-60-90 Day Plan"
        title="How I Would Bring This Approach Forward"
        body="My first quarter would focus on understanding the account, improving visibility, and strengthening the tools and communication routines that help teams stay aligned."
      />

      <div className="relative space-y-10 pl-8 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-px before:bg-white/10">
        {[
          {
            day: '30',
            title: 'Learn The Operation',
            description: 'Meet the client, understand post requirements, review current scheduling rhythms, and learn where visibility is strongest or weakest.',
          },
          {
            day: '60',
            title: 'Stabilize The Workflow',
            description: 'Refine rotations, scheduling communication, and update processes so supervisors and officers have cleaner operational visibility.',
          },
          {
            day: '90',
            title: 'Scale What Works',
            description: 'Build on the strongest tools, improve team communication, and keep creating systems that are easy to use and easy to maintain.',
          },
        ].map((step) => (
          <motion.div
            key={step.day}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="relative"
          >
            <div className="absolute -left-10 top-1 h-4 w-4 rounded-full border-4 border-ispa-navy bg-ispa-blue" />
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.3em] text-ispa-orange">Day {step.day}</p>
              <h3 className="mt-2 text-xl">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>

    <div className="flex items-center justify-center">
      <div className="glass w-full rounded-[2rem] p-8">
        <div className="rounded-[1.5rem] border border-ispa-blue/20 bg-ispa-blue/5 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-ispa-blue">Strategic Goal</p>
          <h3 className="mt-4 text-3xl font-display">Simple Digital Clicks</h3>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Keep building workflows that make complex staffing and supervisory tasks easier to explain, easier to execute, and easier to maintain.
          </p>
        </div>

        <div className="mt-6 space-y-4">
          {[
            'Improve schedule visibility',
            'Strengthen meeting communication',
            'Support supervisors with usable tools',
            'Present account data more clearly',
          ].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-ispa-blue" />
              <span className="text-sm text-slate-200">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ContactSlide = () => (
  <div className="mx-auto max-w-5xl space-y-12 px-6 text-center">
    <div className="space-y-4">
      <h2 className="text-5xl md:text-7xl">Thank You</h2>
      <p className="mx-auto max-w-3xl text-xl font-light text-slate-300">
        Thank you for taking the time to review my account manager presentation and the tools behind my workflow.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-6 pt-8 md:grid-cols-3">
      {[
        { icon: Phone, label: 'Phone', value: '(602) 363-0610' },
        { icon: Mail, label: 'Email', value: 'athletetyreseh@gmail.com' },
        { icon: MapPin, label: 'Location', value: 'Maricopa, AZ' },
      ].map((item) => (
        <motion.div
          key={item.label}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass rounded-[1.75rem] p-6"
        >
          <item.icon className="mx-auto h-6 w-6 text-ispa-blue" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.35em] text-slate-400">{item.label}</p>
          <p className="mt-2 text-sm font-medium text-slate-100">{item.value}</p>
        </motion.div>
      ))}
    </div>

    <div className="glass mx-auto max-w-3xl rounded-[2rem] p-6 text-left">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-ispa-orange">Presentation Assets</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Rotation, scheduler, interview sheet, meeting visuals, profile image, and CPR certification are all embedded and ready to open during discussion.
          </p>
        </div>
        <ActionLink href={assets.rotation.src} label="Open Rotation Tool" filled />
      </div>
    </div>
  </div>
);

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [expandedAsset, setExpandedAsset] = useState<ExpandedAsset | null>(null);

  const slides: SlideDefinition[] = [
    { title: 'Introduction', content: <TitleSlide /> },
    { title: 'Profile', content: <ProfileSlide /> },
    { title: 'Operations', content: <OperationsSlide onExpand={setExpandedAsset} /> },
    { title: 'Communication', content: <CommunicationSlide onExpand={setExpandedAsset} /> },
    { title: 'Hiring', content: <HiringAndComplianceSlide onExpand={setExpandedAsset} /> },
    { title: 'Toolkit', content: <ToolkitSlide /> },
    { title: 'Impact', content: <GrowthSlide /> },
    { title: 'Roadmap', content: <RoadmapSlide /> },
    { title: 'Closing', content: <ContactSlide /> },
  ];

  const nextSlide = useCallback(() => {
    if (currentSlide < slides.length - 1) {
      setDirection(1);
      setCurrentSlide((previous) => previous + 1);
    }
  }, [currentSlide, slides.length]);

  const prevSlide = useCallback(() => {
    if (currentSlide > 0) {
      setDirection(-1);
      setCurrentSlide((previous) => previous - 1);
    }
  }, [currentSlide]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (expandedAsset) {
        if (event.key === 'Escape') {
          setExpandedAsset(null);
        }
        return;
      }

      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        nextSlide();
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevSlide();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedAsset, nextSlide, prevSlide]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-ispa-navy text-slate-100 selection:bg-ispa-blue/30">
      <ProgressBar current={currentSlide} total={slides.length} />

      <AnimatePresence mode="wait" custom={direction}>
        <SlideWrapper key={slides[currentSlide].title} direction={direction}>
          {slides[currentSlide].content}
        </SlideWrapper>
      </AnimatePresence>

      <Navigation current={currentSlide} total={slides.length} onPrev={prevSlide} onNext={nextSlide} />
      <ExpandedAssetModal asset={expandedAsset} onClose={() => setExpandedAsset(null)} />

      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-ispa-blue/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-ispa-orange/5 blur-[120px]" />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]" />
      </div>
    </main>
  );
}
