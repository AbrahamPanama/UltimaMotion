'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, MoveUpRight, Circle, Trash2, Undo2, Minus, Square, Type, Activity, Box, Settings2, X, Layers } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { SYNC_DRAWINGS_KEY } from '@/contexts/app-context';
import { cn } from '@/lib/utils';
import type { DrawingType, PoseAnalyzeScope, PoseModelVariant } from '@/types';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

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
        poseStability,
        setPoseStability,
        poseUseOneEuroFilter,
        setPoseUseOneEuroFilter,
        poseUseExactFrameSync,
        setPoseUseExactFrameSync,
        poseUseIsolatedJointRejection,
        setPoseUseIsolatedJointRejection,
        poseUseLagExtrapolation,
        setPoseUseLagExtrapolation,
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
        is3DViewEnabled,
        toggle3DView,
    } = useAppContext();

    const [isPoseSettingsOpen, setIsPoseSettingsOpen] = useState(false);

    const activeVideo = activeTileIndex !== null ? slots[activeTileIndex] : null;
    const effectiveDrawingId = isSyncDrawingsEnabled ? SYNC_DRAWINGS_KEY : (activeVideo?.id ?? '');
    const currentDrawings = activeVideo ? (drawings[effectiveDrawingId] || []) : [];
    const hasActiveVideo = !!activeVideo;
    const hasAnyVideo = slots.some((slot) => slot !== null);
    const canEdit = isDrawingEnabled && hasActiveVideo;
    const canPose = hasAnyVideo;

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

    const handleToggle3DView = () => {
        if (!canPose || isYoloModel) return;
        toggle3DView();
    };

    const isYoloModel = poseModelVariant.startsWith('yolo');

    return (
        <div className={cn(
            "grid h-full grid-cols-1 gap-2 rounded-lg border border-border/70 bg-background p-2.5",
            className
        )}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(132px,auto),1fr]">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleAnnotate}
                    title={isDrawingEnabled ? "Exit annotate mode" : "Enter annotate mode"}
                    className={cn(
                        "h-10 justify-center gap-2 rounded-md border text-sm font-medium",
                        isDrawingEnabled
                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                            : "bg-background text-foreground border-border hover:bg-secondary",
                        !hasActiveVideo && "opacity-50"
                    )}
                    disabled={!hasActiveVideo}
                >
                    <Pencil className="h-4 w-4" />
                    <span>Annotate</span>
                </Button>

                {/* Sync Drawings toggle — shown when annotate is active */}
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "h-10 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50",
                        isSyncDrawingsEnabled && "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300"
                    )}
                    onClick={toggleSyncDrawings}
                    disabled={!hasActiveVideo}
                    title={isSyncDrawingsEnabled ? 'Disable shared drawings (tiles draw independently)' : 'Enable shared drawings (all tiles share one canvas)'}
                >
                    <Layers className="h-4 w-4" />
                </Button>

                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'free'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('free')}
                        title="Freehand"
                        disabled={!hasActiveVideo}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'line'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('line')}
                        title="Line"
                        disabled={!hasActiveVideo}
                    >
                        <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'arrow'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('arrow')}
                        title="Arrow"
                        disabled={!hasActiveVideo}
                    >
                        <MoveUpRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'angle'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('angle')}
                        title="Angle"
                        disabled={!hasActiveVideo}
                    >
                        <span className="text-base font-semibold leading-none">∠</span>
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'rectangle'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('rectangle')}
                        title="Rectangle"
                        disabled={!hasActiveVideo}
                    >
                        <Square className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'circle'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('circle')}
                        title="Circle"
                        disabled={!hasActiveVideo}
                    >
                        <Circle className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-10 rounded-md border",
                            drawingTool === 'text'
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-foreground hover:bg-secondary",
                            !canEdit && "opacity-50"
                        )}
                        onClick={() => handleSelectTool('text')}
                        title="Text Label"
                        disabled={!hasActiveVideo}
                    >
                        <Type className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                {/* Color picker */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            className={cn("h-10 justify-start gap-2 rounded-md border border-border/70 text-foreground hover:bg-secondary", !canEdit && "opacity-50")}
                            disabled={!hasActiveVideo}
                            title="Drawing color"
                        >
                            <div className="h-5 w-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: drawingColor }} />
                            <span className="text-sm font-medium">Color</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2" align="start">
                        <div className="flex gap-2">
                            {COLORS.map((c) => (
                                <button
                                    key={c.value}
                                    className={cn(
                                        "w-6 h-6 rounded-full border border-border shadow-sm hover:scale-110 transition-transform focus:outline-none focus:ring-2 ring-offset-1 ring-primary",
                                        drawingColor === c.value && "ring-2"
                                    )}
                                    style={{ backgroundColor: c.value }}
                                    onClick={() => setDrawingColor(c.value)}
                                    title={c.name}
                                />
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>

                {/* Pose toggle */}
                <Button
                    variant="ghost"
                    className={cn(
                        "h-10 justify-center gap-2 rounded-md border text-foreground hover:bg-secondary disabled:opacity-50",
                        isPoseEnabled
                            ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15"
                            : "border-border/70",
                    )}
                    onClick={handleTogglePose}
                    disabled={!canPose}
                    title={isPoseEnabled ? 'Disable pose overlay' : 'Enable pose overlay'}
                >
                    <Activity className={cn("h-4 w-4", isPoseEnabled && "animate-pulse")} />
                    <span className="text-sm font-medium">Pose</span>
                </Button>

                {/* Pose settings gear — only when pose is on */}
                <Popover open={isPoseSettingsOpen} onOpenChange={setIsPoseSettingsOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-10 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50",
                                isPoseSettingsOpen && "bg-secondary",
                                !isPoseEnabled && "opacity-40"
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
                                                { label: 'Stability', value: poseStability, set: setPoseStability },
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
                                            { label: 'One Euro Filter', desc: 'Confidence-aware anti-jitter smoothing', value: poseUseOneEuroFilter, set: setPoseUseOneEuroFilter },
                                            { label: 'Exact Frame Sync', desc: 'Prevents duplicate frames', value: poseUseExactFrameSync, set: setPoseUseExactFrameSync },
                                            { label: 'Isolated Joint Rejection', desc: 'Prevents single-joint glitch resets', value: poseUseIsolatedJointRejection, set: setPoseUseIsolatedJointRejection },
                                            { label: 'Lag Extrapolation', desc: 'Predicts forward to hide latency', value: poseUseLagExtrapolation, set: setPoseUseLagExtrapolation },
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

                {/* 3D View */}
                <Button
                    variant="ghost"
                    className={cn(
                        "h-10 justify-center gap-2 rounded-md border text-foreground hover:bg-secondary disabled:opacity-50",
                        is3DViewEnabled
                            ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15"
                            : "border-border/70",
                    )}
                    onClick={handleToggle3DView}
                    disabled={!canPose || isYoloModel}
                    title={isYoloModel ? '3D View requires a MediaPipe model' : (is3DViewEnabled ? 'Disable 3D viewer' : 'Enable 3D viewer')}
                >
                    <Box className={cn("h-4 w-4", is3DViewEnabled && "animate-pulse")} />
                    <span className="text-sm font-medium">3D View</span>
                </Button>

                {/* Undo + Clear */}
                <Button
                    variant="ghost"
                    className="h-10 justify-center gap-2 rounded-md border border-border/70 text-foreground hover:bg-secondary disabled:opacity-50"
                    onClick={handleUndo}
                    disabled={!canEdit || currentDrawings.length === 0}
                    title="Undo last drawing"
                >
                    <Undo2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Undo</span>
                </Button>

                <Button
                    variant="ghost"
                    className="h-10 justify-center gap-2 rounded-md border border-destructive/35 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    onClick={handleClear}
                    disabled={!canEdit || currentDrawings.length === 0}
                    title="Clear all drawings"
                >
                    <Trash2 className="h-4 w-4" />
                    <span className="text-sm font-medium">Clear</span>
                </Button>
            </div>
        </div>
    );
}
