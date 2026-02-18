'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, MoveUpRight, Circle, Trash2, Undo2, Minus, Square, Type } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { cn } from '@/lib/utils';
import type { DrawingType } from '@/types';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

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
        clearDrawings
    } = useAppContext();

    const activeVideo = activeTileIndex !== null ? slots[activeTileIndex] : null;
    const currentDrawings = activeVideo ? (drawings[activeVideo.id] || []) : [];
    const hasActiveVideo = !!activeVideo;
    const canEdit = isDrawingEnabled && hasActiveVideo;

    const handleClear = () => {
        if (activeVideo) {
            clearDrawings(activeVideo.id);
        }
    };

    const handleUndo = () => {
        if (!activeVideo || currentDrawings.length === 0) return;
        setDrawingsForVideo(activeVideo.id, currentDrawings.slice(0, -1));
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

    return (
        <div className={cn(
            "grid h-full grid-cols-1 grid-rows-2 gap-2 rounded-lg border border-border/70 bg-background p-2.5",
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

            <div className="grid grid-cols-3 gap-2">
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
