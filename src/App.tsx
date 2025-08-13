import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import loader from './assets/rplace-loader.gif';
import selectpixel from './assets/selected.svg';

interface Position {
  x: number;
  y: number;
}

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

interface Touch {
  id: number;
  x: number;
  y: number;
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
  
  // Canvas configuration - Initialize with 0 instead of 10
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
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
  
  // Touch state
  const [touches, setTouches] = useState<Touch[]>([]);
  const [lastTouchDistance, setLastTouchDistance] = useState(0);
  const [initialPinchZoom, setInitialPinchZoom] = useState(1);
  const [initialPinchPanX, setInitialPinchPanX] = useState(0);
  const [initialPinchPanY, setInitialPinchPanY] = useState(0);
  const [pinchCenterX, setPinchCenterX] = useState(0);
  const [pinchCenterY, setPinchCenterY] = useState(0);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);
  const [longPressThreshold] = useState(500); // 500ms for long press
  
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
  const [isMobile, setIsMobile] = useState(false);
  
  // Convex queries and mutations
  const canvasData = useQuery(api.functions.getCanvas, {});
  const paletteData = useQuery(api.functions.getPaletteColors, {});
  const initializeCanvas = useMutation(api.functions.initializeCanvas);
  const resizeCanvas = useMutation(api.functions.resizeCanvas);
  const updatePixel = useMutation(api.functions.updatePixel);
  
  const zoomFactor = Math.pow(maxZoom / minZoom, 1/9);
  
  // Keybind mapping for color selection (1-9, a-z)
  const colorKeybinds = '123456789abcdefghijklmnopqrstuvwxyz';
  
  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);
  
  // Helper function to get color index from key
  const getColorIndexFromKey = (key: string): number => {
    const index = colorKeybinds.indexOf(key.toLowerCase());
    return index !== -1 && index < colors.length ? index : -1;
  };
  
  // Touch helper functions
  const getTouchDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch1.x - touch2.x;
    const dy = touch1.y - touch2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  
  const getTouchCenter = (touch1: Touch, touch2: Touch): Position => {
    return {
      x: (touch1.x + touch2.x) / 2,
      y: (touch1.y + touch2.y) / 2
    };
  };
  
  type MyTouch = {
  id: number;
  x: number;
  y: number;
};

const convertTouchList = (touchList: TouchList | React.TouchList, containerRect: DOMRect): MyTouch[] => {
  const touches: MyTouch[] = [];
  for (let i = 0; i < touchList.length; i++) {
    const t = touchList[i] as globalThis.Touch; // Explicitly say it's the DOM Touch
    touches.push({
      id: t.identifier,
      x: t.clientX - containerRect.left,
      y: t.clientY - containerRect.top
    });
  }
  return touches;
};

  
  // Utility functions
  const hexToRgb = (hex: string): ColorRGB => {
    // Trim whitespace and ensure we have a clean hex string
    const cleanHex = hex.trim();
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex);
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
    
    const clampedX = Math.max(0, Math.min(canvasWidth - 1, pixelX));
    const clampedY = Math.max(0, Math.min(canvasHeight - 1, pixelY));
    
    return { x: clampedX, y: clampedY };
  }, [zoom, pixelSize, panX, panY, canvasWidth, canvasHeight]);
  
  const screenToPixel = (screenX: number, screenY: number): Position => {
    const scale = zoom * pixelSize;
    const pixelX = Math.floor((screenX - panX) / scale);
    const pixelY = Math.floor((screenY - panY) / scale);
    
    const clampedX = Math.max(0, Math.min(canvasWidth - 1, pixelX));
    const clampedY = Math.max(0, Math.min(canvasHeight - 1, pixelY));
    
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
    const canvasPixelWidth = canvasWidth * scale;
    const canvasPixelHeight = canvasHeight * scale;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    
    const maxPanX = screenWidth / 2;
    const minPanX = screenWidth / 2 - canvasPixelWidth;
    const maxPanY = screenHeight / 2;
    const minPanY = screenHeight / 2 - canvasPixelHeight;
    
    return {
      x: Math.max(minPanX, Math.min(maxPanX, newPanX)),
      y: Math.max(minPanY, Math.min(maxPanY, newPanY))
    };
  }, [pixelSize, canvasWidth, canvasHeight]);
  
  // Canvas operations
  const updateSinglePixel = (x: number, y: number, color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const index = y * canvasWidth + x;
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
    updatePixel({ x, y, color }).catch(() => {});
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
    if (isLoading || !canvasWidth || !canvasHeight) return;
    
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
  }, [isLoading, canvasWidth, canvasHeight, maxZoom, zoom, zoomFactor, panX, panY, constrainPan]);

  const zoomOut = useCallback(() => {
    if (isLoading || !canvasWidth || !canvasHeight) return;
    
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
  }, [isLoading, canvasWidth, canvasHeight, minZoom, zoom, zoomFactor, panX, panY, constrainPan]);
  
  // UI functions
  const openColorPanel = () => {
    setIsPanelOpen(true);
  };
  
  const closeColorPanel = () => {
    setIsPanelOpen(false);
    setSelectedColor(null);
  };
  
  const selectColorByIndex = (index: number) => {
    if (index >= 0 && index < colors.length) {
      setSelectedColor(colors[index]);
      setIsPanelOpen(true);
    }
  };
  
  const placePixel = () => {
    if (!selectedColor) return;
    
    const coords = getPositionCoords();
    updateSinglePixel(coords.x, coords.y, selectedColor);
    closeColorPanel();
  };
  
  // Touch event handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || !containerRef.current) return;
    
    e.preventDefault();
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newTouches = convertTouchList(e.touches, containerRect);
    setTouches(newTouches);
    
    setIsAnimating(false);
    
    if (newTouches.length === 1) {
      // Single touch - start drag or potential tap
      const touch = newTouches[0];
      setIsDragging(true);
      setLastMouseX(touch.x);
      setLastMouseY(touch.y);
      setMouseDownX(touch.x);
      setMouseDownY(touch.y);
      setIsLongPress(false);
      
      // Start long press timer
      const timer = setTimeout(() => {
        setIsLongPress(true);
        if (!isPanelOpen) {
          openColorPanel();
          // Add haptic feedback if available
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }
      }, longPressThreshold);
      
      setLongPressTimer(timer);
      
    } else if (newTouches.length === 2) {
      // Two touches - start pinch zoom
      clearLongPressTimer();
      setIsDragging(false);
      
      const distance = getTouchDistance(newTouches[0], newTouches[1]);
      const center = getTouchCenter(newTouches[0], newTouches[1]);
      
      setLastTouchDistance(distance);
      setInitialPinchZoom(zoom);
      setInitialPinchPanX(panX);
      setInitialPinchPanY(panY);
      setPinchCenterX(center.x);
      setPinchCenterY(center.y);
    }
  };
  
  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };
  
  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || !containerRef.current) return;
    
    e.preventDefault();
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newTouches = convertTouchList(e.touches, containerRect);
    
    if (newTouches.length === 1 && isDragging) {
      // Single touch panning
      clearLongPressTimer(); // Cancel long press if moving
      
      const touch = newTouches[0];
      const deltaX = touch.x - lastMouseX;
      const deltaY = touch.y - lastMouseY;
      
      const newPanX = panX + deltaX;
      const newPanY = panY + deltaY;
      
      const constrained = constrainPan(newPanX, newPanY, zoom);
      setPanX(constrained.x);
      setPanY(constrained.y);
      
      setLastMouseX(touch.x);
      setLastMouseY(touch.y);
      
    } else if (newTouches.length === 2) {
      // Pinch zoom
      clearLongPressTimer();
      
      const distance = getTouchDistance(newTouches[0], newTouches[1]);

      
      if (lastTouchDistance > 0) {
        
        const newZoom = Math.max(minZoom, Math.min(maxZoom, initialPinchZoom * (distance / lastTouchDistance)));
        
        if (newZoom !== zoom) {
          // Calculate new pan to keep zoom centered on pinch point
          const zoomRatio = newZoom / zoom;
          const newPanX = pinchCenterX - (pinchCenterX - initialPinchPanX) * zoomRatio;
          const newPanY = pinchCenterY - (pinchCenterY - initialPinchPanY) * zoomRatio;
          
          const constrained = constrainPan(newPanX, newPanY, newZoom);
          setPanX(constrained.x);
          setPanY(constrained.y);
          setZoom(newZoom);
        }
      }
    }
    
    setTouches(newTouches);
  }, [isLoading, canvasWidth, canvasHeight, isDragging, lastMouseX, lastMouseY, panX, panY, zoom, lastTouchDistance, initialPinchZoom, initialPinchPanX, initialPinchPanY, pinchCenterX, pinchCenterY, minZoom, maxZoom, constrainPan]);
  
  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || !containerRef.current) return;
    
    e.preventDefault();
    clearLongPressTimer();
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const remainingTouches = convertTouchList(e.touches, containerRect);
    
    if (remainingTouches.length === 0) {
      // All touches ended
      if (isDragging && !isLongPress) {
        setIsDragging(false);
        
        // Check if this was a tap (minimal movement)
        const lastTouch = touches[0];
        if (lastTouch) {
          const deltaX = lastTouch.x - mouseDownX;
          const deltaY = lastTouch.y - mouseDownY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          
          if (distance < dragThreshold) {
            // This was a tap - animate to pixel
            const pixelCoords = screenToPixel(lastTouch.x, lastTouch.y);
            animateToPixel(pixelCoords.x, pixelCoords.y);
          }
        }
      }
      
      setIsLongPress(false);
      setTouches([]);
      setLastTouchDistance(0);
      
    } else if (remainingTouches.length === 1 && touches.length === 2) {
      // Transitioned from pinch to single touch
      const touch = remainingTouches[0];
      setIsDragging(true);
      setLastMouseX(touch.x);
      setLastMouseY(touch.y);
      setMouseDownX(touch.x);
      setMouseDownY(touch.y);
      setLastTouchDistance(0);
    }
    
    setTouches(remainingTouches);
  }, [isLoading, canvasWidth, canvasHeight, isDragging, isLongPress, touches, mouseDownX, mouseDownY, dragThreshold, animateToPixel, screenToPixel]);
  
  // Mouse event handlers (for desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || isMobile) return;
    
    setIsAnimating(false);
    setIsDragging(true);
    setLastMouseX(e.clientX);
    setLastMouseY(e.clientY);
    setMouseDownX(e.clientX);
    setMouseDownY(e.clientY);
    e.preventDefault();
  };
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || !isDragging || isMobile) return;
    
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    
    const newPanX = panX + deltaX;
    const newPanY = panY + deltaY;
    
    const constrained = constrainPan(newPanX, newPanY, zoom);
    setPanX(constrained.x);
    setPanY(constrained.y);
    
    setLastMouseX(e.clientX);
    setLastMouseY(e.clientY);
  }, [isLoading, canvasWidth, canvasHeight, isDragging, isMobile, lastMouseX, lastMouseY, panX, panY, zoom, constrainPan]);
  
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || isMobile) return;
    
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
  }, [isLoading, canvasWidth, canvasHeight, isMobile, isDragging, mouseDownX, mouseDownY, dragThreshold, animateToPixel, screenToPixel]);
  
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || isMobile) return;
    
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
  }, [isLoading, canvasWidth, canvasHeight, isMobile, zoom, panX, panY, zoomFactor, minZoom, maxZoom, constrainPan]);
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isLoading || !canvasWidth || !canvasHeight || isMobile) return;
    
    // Check if this is a color selection key
    const colorIndex = getColorIndexFromKey(e.key);
    if (colorIndex !== -1) {
      e.preventDefault();
      selectColorByIndex(colorIndex);
      return;
    }
    
    const currentCoords = getPositionCoords();
    
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        const newY = Math.max(0, currentCoords.y - 1);
        animateToPixel(currentCoords.x, newY);
        break;
      case 'ArrowDown':
        e.preventDefault();
        const newYDown = Math.min(canvasHeight - 1, currentCoords.y + 1);
        animateToPixel(currentCoords.x, newYDown);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        const newX = Math.max(0, currentCoords.x - 1);
        animateToPixel(newX, currentCoords.y);
        break;
      case 'ArrowRight':
        e.preventDefault();
        const newXRight = Math.min(canvasWidth - 1, currentCoords.x + 1);
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
  }, [isLoading, canvasWidth, canvasHeight, isMobile, getPositionCoords, animateToPixel, zoomIn, zoomOut, isPanelOpen, selectedColor, placePixel, openColorPanel, closeColorPanel, colors, getColorIndexFromKey, selectColorByIndex]);
  
  // Initialize canvas from Convex data
  useEffect(() => {
    const initCanvas = async () => {
      if (canvasData === undefined || paletteData === undefined) return; // Still loading
      
      if (!canvasData && !isInitialized) {
        try {
          await initializeCanvas({});
          setIsInitialized(true);
        } catch (error) {
          // Error handled silently
        }
        return;
      }
      
      if (canvasData && paletteData) {
        // Handle resize if needed
        if (canvasData.needsResize) {
          try {
            await resizeCanvas({});
            // After resize, the data will be refetched automatically by Convex
            return;
          } catch (error) {
            // Error handled silently, continue with current data
          }
        }
        
        setCanvasWidth(canvasData.width);
        setCanvasHeight(canvasData.height);
        setColors(paletteData);
        setPixelData(canvasData.pixels);
        
        // Only center the canvas on initial load, not on subsequent updates
        if (!hasInitiallyPositioned) {
          const initialPanX = (window.innerWidth - canvasData.width * pixelSize) / 2;
          const initialPanY = (window.innerHeight - canvasData.height * pixelSize) / 2;
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
  }, [canvasData, paletteData, isInitialized, pixelSize, hasInitiallyPositioned, resizeCanvas]);

  // Initialize canvas rendering when data is loaded
  useEffect(() => {
    if (isLoading || !pixelData.length || !canvasWidth || !canvasHeight) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    try {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear the canvas first
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        // Render all pixels from data
        const imageData = ctx.createImageData(canvasWidth, canvasHeight);
        
        for (let i = 0; i < pixelData.length; i++) {
          const color = hexToRgb(pixelData[i]);
          const pixelIndex = i * 4;
          imageData.data[pixelIndex] = color.r;
          imageData.data[pixelIndex + 1] = color.g;
          imageData.data[pixelIndex + 2] = color.b;
          imageData.data[pixelIndex + 3] = 255;
        }
        
        ctx.putImageData(imageData, 0, 0);
      }
    } catch (error) {
      // Error handled silently
    }
  }, [isLoading, pixelData, canvasWidth, canvasHeight]);
  
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
    if (isLoading || !canvasWidth || !canvasHeight) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const scale = zoom * pixelSize;
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    canvas.style.transformOrigin = '0 0';
    
    updateSelectionBorder();
  }, [panX, panY, zoom, pixelSize, isLoading, canvasWidth, canvasHeight, getPositionCoords]);
  
  // Event listeners setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Touch events
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Mouse wheel for desktop
    if (!isMobile) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (!isMobile) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleTouchMove, handleTouchEnd, handleWheel, isMobile]);
  
  useEffect(() => {
    // Mouse events for desktop only
    if (!isMobile) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    // Keyboard events (desktop only, since mobile uses touch interface)
    if (!isMobile) {
      document.addEventListener('keydown', handleKeyDown);
    }
    
    return () => {
      if (!isMobile) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [handleMouseMove, handleMouseUp, handleKeyDown, isMobile]);
  
  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);
  
  // Only calculate position if we have valid canvas dimensions
  const currentPosition = canvasWidth && canvasHeight ? getPositionCoords() : { x: 0, y: 0 };
  
  // Render loading screen - now includes canvas dimension check
  if (isLoading || !canvasWidth || !canvasHeight) {
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
    <div className="fixed inset-0 text-white font-mono overflow-hidden">
      <div 
        ref={containerRef}
        className="relative w-full h-full bg-[#333] cursor-default"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onContextMenu={(e) => e.preventDefault()}
        style={{ 
          touchAction: 'none', // Prevent default touch behaviors
          userSelect: 'none', // Prevent text selection
          WebkitUserSelect: 'none'
        }}
      >
        <canvas 
          ref={canvasRef}
          className="absolute pixelated"
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
        <div className="flex w-full p-3 box-border h-[60px]">
          {colors.map((color, index) => {
            // Get the keybind for this color index
            const keybind = index < colorKeybinds.length ? colorKeybinds[index] : null;
            
            return (
              <div
                key={index}
                className={`h-full cursor-pointer transition-all border-2 relative ${
                  selectedColor === color ? 'border-gray-800' : 'border-white'
                }`}
                style={{
                  backgroundColor: color,
                  flex: '1 1 0%',
                  touchAction: 'manipulation'
                }}
                onClick={() => setSelectedColor(color)}
                title={keybind ? `Press '${keybind}' to select` : undefined}
              >
                {/* Show keybind */}
                {keybind && (
                  <div className="absolute top-1 left-1 text-xs font-bold text-white drop-shadow-lg">
                    {keybind}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-center gap-5 mb-3">
          <button
            onClick={closeColorPanel}
            className="text-black cursor-pointer flex items-center justify-center hover:bg-gray-200 rounded transition-colors py-1 px-5 text-xs"
            style={{ touchAction: 'manipulation' }}
          >
            Cancel
          </button>
          <button
            onClick={placePixel}
            disabled={!selectedColor}
            className={`rounded flex items-center justify-center transition-colors py-1 px-5 text-xs ${
              selectedColor 
                ? 'cursor-pointer text-orange-600 hover:bg-orange-50' 
                : 'cursor-not-allowed text-gray-400'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            Place
          </button>
        </div>
      </div>
    </div>
  );
};

export default RPlaceCanvas;