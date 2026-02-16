'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, MoveUpRight, Circle, Trash2, X, Palette } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { cn } from '@/lib/utils';
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

export default function DrawingToolbar() {
    const {
        isDrawingEnabled,
        toggleDrawing,
        drawingTool,
        setDrawingTool,
        drawingColor,
        setDrawingColor,
        activeTileIndex,
        slots,
        clearDrawings
    } = useAppContext();

    const activeVideo = activeTileIndex !== null ? slots[activeTileIndex] : null;

    if (!activeVideo && isDrawingEnabled) {
        // Should probably disable drawing if no video is active, or show disabled state
    }

    const handleClear = () => {
        if (activeVideo) {
            clearDrawings(activeVideo.id);
        }
    };

    return (
        <div className="flex items-center gap-2 p-1 bg-background/80 backdrop-blur-sm border rounded-lg shadow-sm">
            <Button
                variant={isDrawingEnabled ? "default" : "ghost"}
                size="sm"
                onClick={toggleDrawing}
                title={isDrawingEnabled ? "Exit Drawing Mode" : "Enter Drawing Mode"}
                className={cn("gap-2", isDrawingEnabled && "bg-primary text-primary-foreground")}
            >
                <Pencil className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only sm:inline-block">Draw</span>
            </Button>

            {isDrawingEnabled && (
                <>
                    <div className="w-px h-6 bg-border mx-1" />
                    
                    {/* Tools */}
                    <div className="flex items-center gap-1">
                        <Button
                            variant={drawingTool === 'free' ? "secondary" : "ghost"}
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDrawingTool('free')}
                            title="Freehand"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant={drawingTool === 'arrow' ? "secondary" : "ghost"}
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDrawingTool('arrow')}
                            title="Arrow"
                        >
                            <MoveUpRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant={drawingTool === 'circle' ? "secondary" : "ghost"}
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDrawingTool('circle')}
                            title="Circle"
                        >
                            <Circle className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="w-px h-6 bg-border mx-1" />

                    {/* Color Picker */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 p-1"
                                style={{ color: drawingColor }}
                            >
                                <div className="w-5 h-5 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: drawingColor }} />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="center">
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

                    <div className="w-px h-6 bg-border mx-1" />

                    {/* Actions */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={handleClear}
                        title="Clear All Drawings"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </>
            )}
        </div>
    );
}
