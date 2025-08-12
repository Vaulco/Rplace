import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import loader from './assets/rplace-loader.gif'; // Assuming you have a loading animation SVG
import selectpixel from './assets/selected.svg'; // Assuming you have a selection border SVG

interface Position {
  x: number;
  y: number;
}

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

const RPlaceCanvas: React.FC = () => {
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionBorderRef = useRef<HTMLImageElement>(null);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasInitiallyPositioned, setHasInitiallyPositioned] = useState(false);
  
  // Canvas configuration - these will come from Convex
  const [gridSize, setGridSize] = useState(10);
  const [colors, setColors] = useState<string[]>([]);
  
  const [pixelSize] = useState(10);
  const [minZoom] = useState(0.05);
  const [maxZoom] = useState(5);
  
  // Canvas view state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  
  // Interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);
  const [lastMouseY, setLastMouseY] = useState(0);
  const [mouseDownX, setMouseDownX] = useState(0);
  const [mouseDownY, setMouseDownY] = useState(0);
  const [dragThreshold] = useState(3);
  
  // Animation state
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationStartTime, setAnimationStartTime] = useState(0);
  const [animationDuration] = useState(300);
  const [startPanX, setStartPanX] = useState(0);
  const [startPanY, setStartPanY] = useState(0);
  const [targetPanX, setTargetPanX] = useState(0);
  const [targetPanY, setTargetPanY] = useState(0);
  
  // UI state
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [pixelData, setPixelData] = useState<string[]>([]);
  
  // Convex queries and mutations
  const canvasData = useQuery(api.functions.getCanvas, { name: "canvas" });
  const initializeCanvas = useMutation(api.functions.initializeCanvas);
  const updatePixel = useMutation(api.functions.updatePixel);
  
  const zoomFactor = Math.pow(maxZoom / minZoom, 1/9);
  
  // Utility functions
  const hexToRgb = (hex: string): ColorRGB => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
  };
  
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };
  
  // Position calculation functions
  const getPositionCoords = useCallback((): Position => {
    const scale = zoom * pixelSize;
    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    
    const pixelX = Math.floor((screenCenterX - panX) / scale);
    const pixelY = Math.floor((screenCenterY - panY) / scale);
    
    const clampedX = Math.max(0, Math.min(gridSize - 1, pixelX));
    const clampedY = Math.max(0, Math.min(gridSize - 1, pixelY));
    
    return { x: clampedX, y: clampedY };
  }, [zoom, pixelSize, panX, panY, gridSize]);
  
  const screenToPixel = (screenX: number, screenY: number): Position => {
    const scale = zoom * pixelSize;
    const pixelX = Math.floor((screenX - panX) / scale);
    const pixelY = Math.floor((screenY - panY) / scale);
    
    const clampedX = Math.max(0, Math.min(gridSize - 1, pixelX));
    const clampedY = Math.max(0, Math.min(gridSize - 1, pixelY));
    
    return { x: clampedX, y: clampedY };
  };
  
  const calculateCenterPan = useCallback((pixelX: number, pixelY: number): Position => {
    const scale = zoom * pixelSize;
    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    
    const targetPanX = screenCenterX - (pixelX + 0.5) * scale;
    const targetPanY = screenCenterY - (pixelY + 0.5) * scale;
    
    return { x: targetPanX, y: targetPanY };
  }, [zoom, pixelSize]);
  
  const constrainPan = useCallback((newPanX: number, newPanY: number, currentZoom: number): Position => {
    const scale = currentZoom * pixelSize;
    const canvasWidth = gridSize * scale;
    const canvasHeight = gridSize * scale;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    
    const maxPanX = screenWidth / 2;
    const minPanX = screenWidth / 2 - canvasWidth;
    const maxPanY = screenHeight / 2;
    const minPanY = screenHeight / 2 - canvasHeight;
    
    return {
      x: Math.max(minPanX, Math.min(maxPanX, newPanX)),
      y: Math.max(minPanY, Math.min(maxPanY, newPanY))
    };
  }, [pixelSize, gridSize]);
  
  // Canvas operations
  const updateSinglePixel = (x: number, y: number, color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const index = y * gridSize + x;
    const newData = [...pixelData];
    newData[index] = color;
    setPixelData(newData);
    
    const rgb = hexToRgb(color);
    const imageData = ctx.createImageData(1, 1);
    imageData.data[0] = rgb.r;
    imageData.data[1] = rgb.g;
    imageData.data[2] = rgb.b;
    imageData.data[3] = 255;
    
    ctx.putImageData(imageData, x, y);
    
    // Update Convex (fire and forget - optimistic update already applied)
    updatePixel({ name: "canvas", x, y, color }).catch(console.error);
  };
  
  const updateSelectionBorder = () => {
    const border = selectionBorderRef.current;
    if (!border) return;
    
    const coords = getPositionCoords();
    const scale = zoom * pixelSize;
    
    const borderScale = scale * 1.2;
    const offset = (borderScale - scale) / 2;
    
    const pixelScreenX = panX + coords.x * scale;
    const pixelScreenY = panY + coords.y * scale;
    
    border.style.left = `${pixelScreenX - offset}px`;
    border.style.top = `${pixelScreenY - offset}px`;
    border.style.width = `${borderScale}px`;
    border.style.height = `${borderScale}px`;
  };
  
  // Animation functions
  const animateToPixel = useCallback((pixelX: number, pixelY: number) => {
    const targetPan = calculateCenterPan(pixelX, pixelY);
    
    setIsAnimating(true);
    setAnimationStartTime(performance.now());
    setStartPanX(panX);
    setStartPanY(panY);
    setTargetPanX(targetPan.x);
    setTargetPanY(targetPan.y);
  }, [panX, panY, calculateCenterPan]);
  
  // Zoom functions
  const zoomIn = useCallback(() => {
    if (isLoading) return;
    
    setIsAnimating(false);
    const newZoom = Math.min(maxZoom, zoom * zoomFactor);
    if (newZoom !== zoom) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const zoomRatio = newZoom / zoom;
      const newPanX = centerX - (centerX - panX) * zoomRatio;
      const newPanY = centerY - (centerY - panY) * zoomRatio;
      const constrained = constrainPan(newPanX, newPanY, newZoom);
      setPanX(constrained.x);
      setPanY(constrained.y);
      setZoom(newZoom);
    }
  }, [isLoading, maxZoom, zoom, zoomFactor, panX, panY, constrainPan]);

  const zoomOut = useCallback(() => {
    if (isLoading) return;
    
    setIsAnimating(false);
    const newZoom = Math.max(minZoom, zoom / zoomFactor);
    if (newZoom !== zoom) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const zoomRatio = newZoom / zoom;
      const newPanX = centerX - (centerX - panX) * zoomRatio;
      const newPanY = centerY - (centerY - panY) * zoomRatio;
      const constrained = constrainPan(newPanX, newPanY, newZoom);
      setPanX(constrained.x);
      setPanY(constrained.y);
      setZoom(newZoom);
    }
  }, [isLoading, minZoom, zoom, zoomFactor, panX, panY, constrainPan]);
  
  // UI functions
  const openColorPanel = () => {
    setIsPanelOpen(true);
  };
  
  const closeColorPanel = () => {
    setIsPanelOpen(false);
    setSelectedColor(null);
  };
  
  const placePixel = () => {
    if (!selectedColor) return;
    
    const coords = getPositionCoords();
    updateSinglePixel(coords.x, coords.y, selectedColor);
    closeColorPanel();
  };
  
  // Event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLoading) return;
    
    setIsAnimating(false);
    setIsDragging(true);
    setLastMouseX(e.clientX);
    setLastMouseY(e.clientY);
    setMouseDownX(e.clientX);
    setMouseDownY(e.clientY);
    e.preventDefault();
  };
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isLoading || !isDragging) return;
    
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    
    const newPanX = panX + deltaX;
    const newPanY = panY + deltaY;
    
    const constrained = constrainPan(newPanX, newPanY, zoom);
    setPanX(constrained.x);
    setPanY(constrained.y);
    
    setLastMouseX(e.clientX);
    setLastMouseY(e.clientY);
  }, [isLoading, isDragging, lastMouseX, lastMouseY, panX, panY, zoom, constrainPan]);
  
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isLoading) return;
    
    if (isDragging) {
      setIsDragging(false);
      
      const deltaX = e.clientX - mouseDownX;
      const deltaY = e.clientY - mouseDownY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance < dragThreshold && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        const pixelCoords = screenToPixel(clickX, clickY);
        animateToPixel(pixelCoords.x, pixelCoords.y);
      }
    }
  }, [isLoading, isDragging, mouseDownX, mouseDownY, dragThreshold, animateToPixel, screenToPixel]);
  
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isLoading) return;
    
    e.preventDefault();
    setIsAnimating(false);
    
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomMultiplier = e.deltaY > 0 ? (1 / zoomFactor) : zoomFactor;
    const newZoom = Math.max(minZoom, Math.min(maxZoom, zoom * zoomMultiplier));
    
    if (newZoom !== zoom) {
      const zoomRatio = newZoom / zoom;
      const newPanX = mouseX - (mouseX - panX) * zoomRatio;
      const newPanY = mouseY - (mouseY - panY) * zoomRatio;
      
      const constrained = constrainPan(newPanX, newPanY, newZoom);
      setPanX(constrained.x);
      setPanY(constrained.y);
      setZoom(newZoom);
    }
  }, [isLoading, zoom, panX, panY, zoomFactor, minZoom, maxZoom, constrainPan]);
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isLoading) return;
    
    const currentCoords = getPositionCoords();
    
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        const newY = Math.max(0, currentCoords.y - 1);
        animateToPixel(currentCoords.x, newY);
        break;
      case 'ArrowDown':
        e.preventDefault();
        const newYDown = Math.min(gridSize - 1, currentCoords.y + 1);
        animateToPixel(currentCoords.x, newYDown);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        const newX = Math.max(0, currentCoords.x - 1);
        animateToPixel(newX, currentCoords.y);
        break;
      case 'ArrowRight':
        e.preventDefault();
        const newXRight = Math.min(gridSize - 1, currentCoords.x + 1);
        animateToPixel(newXRight, currentCoords.y);
        break;
      case '=':
      case '+':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
        e.preventDefault();
        zoomOut();
        break;
      case ' ':
        e.preventDefault();
        if (!isPanelOpen) {
          openColorPanel();
        } else if (selectedColor) {
          placePixel();
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isPanelOpen && selectedColor) {
          placePixel();
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (isPanelOpen) {
          closeColorPanel();
        }
        break;
    }
  }, [isLoading, getPositionCoords, animateToPixel, gridSize, zoomIn, zoomOut, isPanelOpen, selectedColor, placePixel, openColorPanel, closeColorPanel]);
  
  // Initialize canvas from Convex data
  useEffect(() => {
    const initCanvas = async () => {
      if (canvasData === undefined) return; // Still loading
      
      if (!canvasData && !isInitialized) {
        try {
          await initializeCanvas({
            name: "canvas",
            size: 10,
          });
          setIsInitialized(true);
        } catch (error) {
          console.error('Failed to initialize canvas:', error);
        }
        return;
      }
      
      if (canvasData) {
        setGridSize(canvasData.size);
        setColors(canvasData.palette || []);
        setPixelData(canvasData.pixels);
        
        // Only center the canvas on initial load, not on subsequent updates
        if (!hasInitiallyPositioned) {
          const initialPanX = (window.innerWidth - canvasData.size * pixelSize) / 2;
          const initialPanY = (window.innerHeight - canvasData.size * pixelSize) / 2;
          setPanX(initialPanX);
          setPanY(initialPanY);
          setHasInitiallyPositioned(true);
        }
        
        // Set loading to false after a short delay
        setTimeout(() => {
          setIsLoading(false);
        }, 500);
      }
    };
    
    initCanvas();
  }, [canvasData, isInitialized, pixelSize, hasInitiallyPositioned]);

  // Initialize canvas rendering when data is loaded
  useEffect(() => {
    if (isLoading || !pixelData.length) return;
    
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    
    try {
      canvas.width = gridSize;
      canvas.height = gridSize;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Render all pixels from data
        const imageData = ctx.createImageData(gridSize, gridSize);
        
        for (let i = 0; i < pixelData.length; i++) {
          const color = hexToRgb(pixelData[i]);
          const pixelIndex = i * 4;
          imageData.data[pixelIndex] = color.r;
          imageData.data[pixelIndex + 1] = color.g;
          imageData.data[pixelIndex + 2] = color.b;
          imageData.data[pixelIndex + 3] = 255;
        }
        
        ctx.putImageData(imageData, 0, 0);
      } else {
        console.error('Could not get canvas context');
      }
    } catch (error) {
      console.error('Error in canvas setup:', error);
    }
  }, [isLoading, pixelData, gridSize]);
  
  useEffect(() => {
    let animationId: number;
    
    const animate = (currentTime: number) => {
      if (isAnimating) {
        const elapsed = currentTime - animationStartTime;
        const progress = Math.min(elapsed / animationDuration, 1);
        const easedProgress = easeOutCubic(progress);
        
        const newPanX = startPanX + (targetPanX - startPanX) * easedProgress;
        const newPanY = startPanY + (targetPanY - startPanY) * easedProgress;
        
        const constrained = constrainPan(newPanX, newPanY, zoom);
        setPanX(constrained.x);
        setPanY(constrained.y);
        
        if (progress >= 1) {
          setIsAnimating(false);
        }
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isAnimating, animationStartTime, startPanX, startPanY, targetPanX, targetPanY, zoom, constrainPan]);
  
  useEffect(() => {
    if (isLoading) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const scale = zoom * pixelSize;
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    canvas.style.transformOrigin = '0 0';
    
    updateSelectionBorder();
  }, [panX, panY, zoom, pixelSize, isLoading, getPositionCoords]);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);
  
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleMouseMove, handleMouseUp, handleKeyDown]);
  
  const currentPosition = getPositionCoords();
  
  // Render loading screen
  if (isLoading) {
    return (
      <div className="w-screen h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="w-32 h-32 flex items-center justify-center">
            <img 
              src={loader}
              alt="Loading animation" 
              className="max-w-full max-h-full object-contain"
            /> 
          </div>

        </div>
      </div>
    );
  }
  
  // Render main interface
  return (
    <div className="w-screen h-screen text-white font-mono overflow-hidden">
      <div 
        ref={containerRef}
        className="relative w-full h-full bg-[#333] cursor-default"
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas 
          ref={canvasRef}
          className="absolute pixelated"
          style={{ imageRendering: 'pixelated' }}
        />
        
        <img
          ref={selectionBorderRef}
          src={selectpixel}
          alt="Selection Border"
          className="absolute pointer-events-none z-50 pixelated"
        />
      </div>
      
      <div className="absolute top-5 left-1/2 transform -translate-x-1/2 bg-white text-black px-4 py-1 rounded-full text-xs z-20 shadow-lg">
        ({currentPosition.x}, {currentPosition.y}) {zoom.toFixed(2)}x
      </div>
      
      {!isPanelOpen && (
        <button
          onClick={openColorPanel}
          className="absolute bottom-5 left-1/2 transform -translate-x-1/2 bg-white text-black px-8 py-1 rounded-full text-xs z-20 shadow-lg hover:bg-gray-100 transition-colors"
        >
          Place a tile
        </button>
      )}
      
      <div className={`fixed bottom-0 left-0 right-0 bg-white bg-opacity-90 shadow-lg z-30 backdrop-blur-sm transition-transform duration-300 ease-out ${
        isPanelOpen ? 'transform translate-y-0' : 'transform translate-y-full'
      }`}>
        <div className="flex w-full h-[60px] p-3 box-border">
          {colors.map((color, index) => (
            <div
              key={index}
              className={`h-full cursor-pointer transition-all border-2 ${
                selectedColor === color ? 'border-gray-800' : 'border-white'
              }`}
              style={{
                backgroundColor: color,
                flex: '1 1 0%'
              }}
              onClick={() => setSelectedColor(color)}
            />
          ))}
        </div>
        <div className="flex justify-center gap-5 mb-3">
          <button
            onClick={closeColorPanel}
            className="py-1 px-5 text-black cursor-pointer flex items-center justify-center text-xs hover:bg-gray-200 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={placePixel}
            disabled={!selectedColor}
            className={`py-1 px-5 rounded text-xs flex items-center justify-center transition-colors ${
              selectedColor 
                ? 'cursor-pointer text-orange-600 hover:bg-orange-50' 
                : 'cursor-not-allowed text-gray-400'
            }`}
          >
            Place
          </button>
        </div>
      </div>
    </div>
  );
};

export default RPlaceCanvas;