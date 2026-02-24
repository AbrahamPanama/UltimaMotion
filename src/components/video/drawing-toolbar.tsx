'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, MoveUpRight, Circle, Trash2, Undo2, Minus, Square, Type, Activity, Settings2, X, Layers, Smartphone, Radio } from 'lucide-react';
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from '@/components/ui/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useAppContext } from '@/contexts/app-context';
import { cn } from '@/lib/utils';
import type { DrawingType, PoseModelVariant, PoseAnalyzeScope } from '@/types';

const SYNC_DRAWINGS_KEY = '__sync__';

const COLORS = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'White', value: '#ffffff' },
    { name: 'Black', value: '#000000' },
];

interface DrawingToolbarProps {
    className?: string;
}

export default function DrawingToolbar({ className }: DrawingToolbarProps) {
    const {
        isDrawingEnabled,
        toggleDrawing,
        drawingTool,
        setDrawingTool,
        drawingColor,
        setDrawingColor,
        drawings,
        setDrawingsForVideo,
        activeTileIndex,
        slots,
        clearDrawings,
        // Pose overlay
        isPoseEnabled,
        togglePose,
        poseModelVariant,
        setPoseModelVariant,
        poseAnalyzeScope,
        setPoseAnalyzeScope,
        poseMinVisibility,
        setPoseMinVisibility,
        poseUseExactFrameSync,
        setPoseUseExactFrameSync,
        poseUseSmoothing,
        setPoseUseSmoothing,
        poseUsePreprocessCache,
        setPoseUsePreprocessCache,
        poseUseYoloMultiPerson,
        setPoseUseYoloMultiPerson,
        poseShowCoG,
        setPoseShowCoG,
        poseShowCoGCharts,
        setPoseShowCoGCharts,
        poseShowJointAngles,
        setPoseShowJointAngles,
        poseShowBodyLean,
        setPoseShowBodyLean,
        poseShowJumpHeight,
        setPoseShowJumpHeight,
        poseTargetFps,
        setPoseTargetFps,
        poseMinPoseDetectionConfidence,
        setPoseMinPoseDetectionConfidence,
        poseMinPosePresenceConfidence,
        setPoseMinPosePresenceConfidence,
        poseMinTrackingConfidence,
        setPoseMinTrackingConfidence,
        isSyncDrawingsEnabled,
        toggleSyncDrawings,
        // View controls
        isPortraitMode,
        togglePortraitMode,
        isSyncEnabled,
        toggleSync,
    } = useAppContext();

    const [isPoseSettingsOpen, setIsPoseSettingsOpen] = useState(false);

    const activeVideo = activeTileIndex !== null ? slots[activeTileIndex] : null;
    const effectiveDrawingId = isSyncDrawingsEnabled ? SYNC_DRAWINGS_KEY : (activeVideo?.id ?? '');
    const currentDrawings = activeVideo ? (drawings[effectiveDrawingId] || []) : [];
    const hasActiveVideo = !!activeVideo;
    const hasAnyVideo = slots.some((slot) => slot !== null);
    const canEdit = isDrawingEnabled && hasActiveVideo;
    const canPose = hasAnyVideo;

    const isYoloModel = poseModelVariant.startsWith('yolo');

    const handleClear = () => {
        if (activeVideo) {
            clearDrawings(effectiveDrawingId);
        }
    };

    const handleUndo = () => {
        if (!activeVideo || currentDrawings.length === 0) return;
        setDrawingsForVideo(effectiveDrawingId, currentDrawings.slice(0, -1));
    };

    const handleToggleAnnotate = () => {
        if (!hasActiveVideo) return;
        toggleDrawing();
    };

    const handleSelectTool = (tool: DrawingType) => {
        if (!hasActiveVideo) return;
        if (!isDrawingEnabled) {
            toggleDrawing();
        }
        setDrawingTool(tool);
    };

    const handleTogglePose = () => {
        if (!canPose) return;
        togglePose();
    };

    /* ── Shared button helpers ── */
    const iconBtn = (active: boolean, tone: 'default' | 'teal' | 'primary' | 'destructive' = 'default') =>
        cn(
            'h-9 w-9 rounded-md border transition-colors',
            active
                ? tone === 'teal'
                    ? 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15'
                    : tone === 'destructive'
                        ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
                        : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                : 'border-border/70 text-foreground hover:bg-secondary',
            !hasActiveVideo && !hasAnyVideo && 'opacity-50 pointer-events-none'
        );

    const toolBtn = (tool: DrawingType) =>
        cn(
            'h-9 w-9 rounded-md border transition-colors',
            drawingTool === tool && isDrawingEnabled
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/70 text-foreground hover:bg-secondary',
            !canEdit && 'opacity-40'
        );

    const sep = <span className="mx-0.5 h-6 w-px bg-border/60 hidden sm:block flex-shrink-0" />;

    const TOOLS: { tool: DrawingType; icon: React.ReactNode; title: string }[] = [
        { tool: 'free', icon: <Pencil className="h-4 w-4" />, title: 'Freehand' },
        { tool: 'line', icon: <Minus className="h-4 w-4" />, title: 'Line' },
        { tool: 'arrow', icon: <MoveUpRight className="h-4 w-4" />, title: 'Arrow' },
        { tool: 'angle', icon: <span className="text-base font-semibold leading-none">∠</span>, title: 'Angle' },
        { tool: 'rectangle', icon: <Square className="h-4 w-4" />, title: 'Rectangle' },
        { tool: 'circle', icon: <Circle className="h-4 w-4" />, title: 'Circle' },
        { tool: 'text', icon: <Type className="h-4 w-4" />, title: 'Text' },
    ];

    return (
        <div className={cn('flex flex-wrap items-center gap-1.5', className)}>

            {/* ── View Group: Portrait + Video Sync ── */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={togglePortraitMode}
                    className={iconBtn(isPortraitMode, 'primary')}
                    aria-pressed={isPortraitMode}
                    title="Portrait framing"
                >
                    <Smartphone className="h-4 w-4" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleSync}
                    className={iconBtn(isSyncEnabled, 'primary')}
                    aria-pressed={isSyncEnabled}
                    title="Sync all active videos"
                >
                    <Radio className={cn('h-4 w-4', isSyncEnabled && 'animate-pulse')} />
                </Button>
            </div>

            {sep}

            {/* ── Annotate Group: Toggle + Sync Drawings + Tools + Color ── */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleAnnotate}
                    title={isDrawingEnabled ? 'Exit annotate mode' : 'Enter annotate mode'}
                    className={cn(
                        'h-9 gap-1.5 rounded-md border px-2.5 text-xs font-medium',
                        isDrawingEnabled
                            ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                            : 'bg-background text-foreground border-border hover:bg-secondary',
                        !hasActiveVideo && 'opacity-50'
                    )}
                    disabled={!hasActiveVideo}
                >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Annotate</span>
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'h-9 w-9 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50',
                        isSyncDrawingsEnabled && 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300'
                    )}
                    onClick={toggleSyncDrawings}
                    disabled={!hasActiveVideo}
                    title={isSyncDrawingsEnabled ? 'Disable shared drawings' : 'Enable shared drawings (all tiles share one canvas)'}
                >
                    <Layers className="h-4 w-4" />
                </Button>
            </div>

            {/* Tool icons — show inline when annotate is enabled */}
            {isDrawingEnabled && (
                <>
                    <div className="flex items-center gap-1">
                        {TOOLS.map(({ tool, icon, title }) => (
                            <Button
                                key={tool}
                                variant="ghost"
                                size="icon"
                                className={toolBtn(tool)}
                                onClick={() => handleSelectTool(tool)}
                                title={title}
                                disabled={!hasActiveVideo}
                            >
                                {icon}
                            </Button>
                        ))}
                    </div>

                    {/* Color picker */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn('h-9 w-9 rounded-md border border-border/70 hover:bg-secondary', !canEdit && 'opacity-40')}
                                disabled={!hasActiveVideo}
                                title="Drawing color"
                            >
                                <div className="h-5 w-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: drawingColor }} />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                            <div className="flex gap-2">
                                {COLORS.map((c) => (
                                    <button
                                        key={c.value}
                                        className={cn(
                                            'w-6 h-6 rounded-full border border-border shadow-sm hover:scale-110 transition-transform focus:outline-none focus:ring-2 ring-offset-1 ring-primary',
                                            drawingColor === c.value && 'ring-2'
                                        )}
                                        style={{ backgroundColor: c.value }}
                                        onClick={() => setDrawingColor(c.value)}
                                        title={c.name}
                                    />
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                </>
            )}

            {sep}

            {/* ── Pose Group: Toggle + Settings gear ── */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-9 gap-1.5 rounded-md border px-2.5 text-xs font-medium',
                        isPoseEnabled
                            ? 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15'
                            : 'border-border/70 text-foreground hover:bg-secondary',
                        !canPose && 'opacity-50'
                    )}
                    onClick={handleTogglePose}
                    disabled={!canPose}
                    title={isPoseEnabled ? 'Disable pose overlay' : 'Enable pose overlay'}
                >
                    <Activity className={cn('h-3.5 w-3.5', isPoseEnabled && 'animate-pulse')} />
                    <span className="hidden sm:inline">Pose</span>
                </Button>

                <Popover open={isPoseSettingsOpen} onOpenChange={setIsPoseSettingsOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                'h-9 w-9 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50',
                                isPoseSettingsOpen && 'bg-secondary',
                                !isPoseEnabled && 'opacity-40'
                            )}
                            disabled={!isPoseEnabled}
                            title="Pose settings"
                        >
                            <Settings2 className="h-4 w-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-80 p-0 overflow-hidden"
                        align="start"
                        side="top"
                        sideOffset={8}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5 bg-secondary/40">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Pose Settings</p>
                            <button
                                onClick={() => setIsPoseSettingsOpen(false)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
                            {/* Model + Scope */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Model</p>
                                    <Select value={poseModelVariant} onValueChange={(v) => setPoseModelVariant(v as PoseModelVariant)}>
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="yolo26-nano">YOLO26 Nano</SelectItem>
                                            <SelectItem value="yolo26-small">YOLO26 Small</SelectItem>
                                            <SelectItem value="yolo26-medium">YOLO26 Medium</SelectItem>
                                            <SelectItem value="yolo26-large">YOLO26 Large</SelectItem>
                                            <SelectItem value="yolo26-xlarge">YOLO26 X-Large</SelectItem>
                                            <SelectItem value="lite">MP Lite</SelectItem>
                                            <SelectItem value="full">MP Full</SelectItem>
                                            <SelectItem value="heavy">MP Heavy</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Scope</p>
                                    <Select value={poseAnalyzeScope} onValueChange={(v) => setPoseAnalyzeScope(v as PoseAnalyzeScope)}>
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active-tile">Active tile</SelectItem>
                                            <SelectItem value="all-visible">All tiles</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Inference FPS slider */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                    <span>Inference FPS</span>
                                    <span>{poseTargetFps}</span>
                                </div>
                                <Slider value={[poseTargetFps]} min={5} max={60} step={1} onValueChange={([v]) => setPoseTargetFps(v)} />
                            </div>

                            <div className="border-t border-border/50 pt-2 space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Stability</p>
                                <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                                    <div>
                                        <p className="text-[11px] font-medium text-foreground">Temporal Smoothing</p>
                                        <p className="text-[10px] text-muted-foreground/80">1€ filter to reduce landmark jitter (recommended for YOLO)</p>
                                    </div>
                                    <Switch checked={poseUseSmoothing} onCheckedChange={setPoseUseSmoothing} />
                                </div>
                            </div>

                            {isYoloModel && (
                                <div className="border-t border-border/50 pt-2 space-y-1.5">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">YOLO</p>
                                    <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                                        <div>
                                            <p className="text-[11px] font-medium text-foreground">Preprocess Clip</p>
                                            <p className="text-[10px] text-muted-foreground/80">Analyze and cache poses frame-by-frame before review playback</p>
                                        </div>
                                        <Switch checked={poseUsePreprocessCache} onCheckedChange={setPoseUsePreprocessCache} />
                                    </div>
                                    <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                                        <div>
                                            <p className="text-[11px] font-medium text-foreground">Multi-Person Detection</p>
                                            <p className="text-[10px] text-muted-foreground/80">Decode and render up to 4 people instead of only the top subject</p>
                                        </div>
                                        <Switch checked={poseUseYoloMultiPerson} onCheckedChange={setPoseUseYoloMultiPerson} />
                                    </div>
                                </div>
                            )}

                            <div className="border-t border-border/50 pt-2 space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Analytics</p>
                                {[
                                    { label: 'Center of Gravity', desc: 'Segment-weighted body mass center marker', value: poseShowCoG, set: setPoseShowCoG },
                                    { label: 'CoG Axis Charts', desc: 'True-time X/Y/Z movement curves overlaid on video', value: poseShowCoGCharts, set: setPoseShowCoGCharts },
                                    { label: 'Joint Angles', desc: 'Knee, hip & elbow angle arcs', value: poseShowJointAngles, set: setPoseShowJointAngles },
                                    { label: 'Body Lean', desc: 'Torso tilt from vertical', value: poseShowBodyLean, set: setPoseShowBodyLean },
                                    { label: 'Jump Height', desc: 'Vertical displacement from baseline', value: poseShowJumpHeight, set: setPoseShowJumpHeight },
                                ].map(({ label, desc, value, set }) => (
                                    <div key={label} className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                                        <div>
                                            <p className="text-[11px] font-medium text-foreground">{label}</p>
                                            <p className="text-[10px] text-muted-foreground/80">{desc}</p>
                                        </div>
                                        <Switch checked={value} onCheckedChange={set} />
                                    </div>
                                ))}
                            </div>

                            {/* MediaPipe-only settings */}
                            {!isYoloModel && (
                                <>
                                    <div className="border-t border-border/50 pt-2 space-y-1.5">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Confidence</p>
                                        <div className="space-y-2">
                                            {[
                                                { label: 'Detection', value: poseMinPoseDetectionConfidence, set: setPoseMinPoseDetectionConfidence },
                                                { label: 'Presence', value: poseMinPosePresenceConfidence, set: setPoseMinPosePresenceConfidence },
                                                { label: 'Tracking', value: poseMinTrackingConfidence, set: setPoseMinTrackingConfidence },
                                                { label: 'Min Visibility', value: poseMinVisibility, set: setPoseMinVisibility },
                                            ].map(({ label, value, set }) => (
                                                <div key={label} className="space-y-1">
                                                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                        <span>{label}</span>
                                                        <span>{value.toFixed(2)}</span>
                                                    </div>
                                                    <Slider value={[value]} min={0} max={1} step={0.05} onValueChange={([v]) => set(v)} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="border-t border-border/50 pt-2 space-y-1.5">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Filters</p>
                                        {[
                                            { label: 'Exact Frame Sync', desc: 'Prevents duplicate frames', value: poseUseExactFrameSync, set: setPoseUseExactFrameSync },
                                        ].map(({ label, desc, value, set }) => (
                                            <div key={label} className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                                                <div>
                                                    <p className="text-[11px] font-medium text-foreground">{label}</p>
                                                    <p className="text-[10px] text-muted-foreground/80">{desc}</p>
                                                </div>
                                                <Switch checked={value} onCheckedChange={set} />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {sep}

            {/* ── Undo + Clear ── */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50"
                    onClick={handleUndo}
                    disabled={!canEdit || currentDrawings.length === 0}
                    title="Undo last drawing"
                >
                    <Undo2 className="h-4 w-4" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-md border border-destructive/35 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    onClick={handleClear}
                    disabled={!canEdit || currentDrawings.length === 0}
                    title="Clear all drawings"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
