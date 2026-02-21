/**
 * Biomechanics calculations derived from MediaPipe pose landmarks.
 *
 * All functions operate on projected pixel-space points (x, y, visibility).
 * MediaPipe landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#pose_landmarker_model
 */

// ── Types ──

export interface Point2D {
    x: number;
    y: number;
    visibility: number;
}

export interface CenterOfGravity {
    x: number;
    y: number;
}

export interface JointAngle {
    /** MediaPipe landmark index of the joint vertex */
    jointIndex: number;
    /** Label for display */
    label: string;
    /** Angle in degrees (0-180) */
    degrees: number;
    /** Position of the vertex point (for rendering) */
    vertex: Point2D;
    /** Position of the first ray endpoint */
    pointA: Point2D;
    /** Position of the second ray endpoint */
    pointB: Point2D;
    /** Start angle of the arc in radians (for SVG rendering) */
    startAngle: number;
    /** Sweep angle of the arc in radians */
    sweepAngle: number;
}

export interface BodyLean {
    /** Lean angle in degrees. Negative = leaning left, Positive = leaning right */
    angleDeg: number;
    /** Shoulder midpoint */
    shoulderMid: Point2D;
    /** Hip midpoint */
    hipMid: Point2D;
}

export interface JumpHeight {
    /** Current height above baseline in pixels */
    heightPx: number;
    /** Height as fraction of frame height */
    heightFraction: number;
    /** Current CoG position */
    cogPosition: CenterOfGravity;
    /** Baseline Y position (lowest observed CoG) */
    baselineY: number;
}

// ── Landmark Indices ──

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
const L_ANKLE = 27;
const R_ANKLE = 28;
const NOSE = 0;

// ── Segment mass percentages (Winter, 2009 — standard anthropometric data) ──

interface SegmentDef {
    from: number;
    to: number;
    massPercent: number;
}

const BODY_SEGMENTS: SegmentDef[] = [
    // Head: nose to ear midpoint (approximation)
    { from: NOSE, to: NOSE, massPercent: 0.081 }, // Head uses nose as single point
    // Torso: shoulder midpoint to hip midpoint (computed separately)
    // Upper arms
    { from: L_SHOULDER, to: L_ELBOW, massPercent: 0.027 },
    { from: R_SHOULDER, to: R_ELBOW, massPercent: 0.027 },
    // Forearms + hands
    { from: L_ELBOW, to: L_WRIST, massPercent: 0.023 },
    { from: R_ELBOW, to: R_WRIST, massPercent: 0.023 },
    // Thighs
    { from: L_HIP, to: L_KNEE, massPercent: 0.100 },
    { from: R_HIP, to: R_KNEE, massPercent: 0.100 },
    // Shanks + feet
    { from: L_KNEE, to: L_ANKLE, massPercent: 0.059 },
    { from: R_KNEE, to: R_ANKLE, massPercent: 0.059 },
];

const TORSO_MASS_PERCENT = 0.432; // Trunk

// ── Helper Functions ──

const midpoint = (a: Point2D, b: Point2D): Point2D => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility, b.visibility),
});

const isVisible = (point: Point2D, threshold = 0.1): boolean =>
    point.visibility >= threshold;

/**
 * Calculate angle between vectors BA and BC at vertex B.
 * Returns angle in degrees [0, 180].
 */
const angleBetween = (
    a: Point2D,
    b: Point2D,
    c: Point2D
): { degrees: number; startAngle: number; sweepAngle: number } => {
    const baX = a.x - b.x;
    const baY = a.y - b.y;
    const bcX = c.x - b.x;
    const bcY = c.y - b.y;

    const dot = baX * bcX + baY * bcY;
    const magBA = Math.sqrt(baX * baX + baY * baY);
    const magBC = Math.sqrt(bcX * bcX + bcY * bcY);

    if (magBA < 1e-6 || magBC < 1e-6) {
        return { degrees: 0, startAngle: 0, sweepAngle: 0 };
    }

    const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
    const degrees = Math.acos(cosAngle) * (180 / Math.PI);

    // Compute arc angles for SVG rendering
    const angleA = Math.atan2(baY, baX);
    const angleC = Math.atan2(bcY, bcX);

    // Determine sweep direction (always take the smaller arc)
    let sweep = angleC - angleA;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;

    return {
        degrees,
        startAngle: angleA,
        sweepAngle: sweep,
    };
};

// ── Public API ──

/**
 * Compute the estimated center of gravity using segment-weighted averaging.
 */
export const computeCoG = (pose: Point2D[]): CenterOfGravity | null => {
    if (pose.length < 29) return null; // Need at least up to ankle landmarks

    const shoulderMid = midpoint(pose[L_SHOULDER], pose[R_SHOULDER]);
    const hipMid = midpoint(pose[L_HIP], pose[R_HIP]);

    // Check minimum visibility
    if (!isVisible(shoulderMid) || !isVisible(hipMid)) return null;

    let totalX = 0;
    let totalY = 0;
    let totalMass = 0;

    // Head (use nose position)
    const head = pose[NOSE];
    if (isVisible(head)) {
        totalX += head.x * BODY_SEGMENTS[0].massPercent;
        totalY += head.y * BODY_SEGMENTS[0].massPercent;
        totalMass += BODY_SEGMENTS[0].massPercent;
    }

    // Torso (shoulder midpoint to hip midpoint)
    const torsoCenter = midpoint(shoulderMid, hipMid);
    totalX += torsoCenter.x * TORSO_MASS_PERCENT;
    totalY += torsoCenter.y * TORSO_MASS_PERCENT;
    totalMass += TORSO_MASS_PERCENT;

    // Limb segments (skip head at index 0)
    for (let i = 1; i < BODY_SEGMENTS.length; i++) {
        const seg = BODY_SEGMENTS[i];
        const from = pose[seg.from];
        const to = pose[seg.to];
        if (!isVisible(from) || !isVisible(to)) continue;

        const segCenter = midpoint(from, to);
        totalX += segCenter.x * seg.massPercent;
        totalY += segCenter.y * seg.massPercent;
        totalMass += seg.massPercent;
    }

    if (totalMass < 0.3) return null; // Not enough visible segments

    return {
        x: totalX / totalMass,
        y: totalY / totalMass,
    };
};

/**
 * Compute 6 key joint angles: L/R knee, L/R hip, L/R elbow.
 */
export const computeJointAngles = (pose: Point2D[]): JointAngle[] => {
    if (pose.length < 29) return [];

    const definitions: Array<{
        label: string;
        jointIndex: number;
        a: number; // first ray
        b: number; // vertex
        c: number; // second ray
    }> = [
            { label: 'L Knee', jointIndex: L_KNEE, a: L_HIP, b: L_KNEE, c: L_ANKLE },
            { label: 'R Knee', jointIndex: R_KNEE, a: R_HIP, b: R_KNEE, c: R_ANKLE },
            { label: 'L Hip', jointIndex: L_HIP, a: L_SHOULDER, b: L_HIP, c: L_KNEE },
            { label: 'R Hip', jointIndex: R_HIP, a: R_SHOULDER, b: R_HIP, c: R_KNEE },
            { label: 'L Elbow', jointIndex: L_ELBOW, a: L_SHOULDER, b: L_ELBOW, c: L_WRIST },
            { label: 'R Elbow', jointIndex: R_ELBOW, a: R_SHOULDER, b: R_ELBOW, c: R_WRIST },
        ];

    const results: JointAngle[] = [];

    for (const def of definitions) {
        const pointA = pose[def.a];
        const vertex = pose[def.b];
        const pointB = pose[def.c];

        if (!isVisible(pointA) || !isVisible(vertex) || !isVisible(pointB)) continue;

        const { degrees, startAngle, sweepAngle } = angleBetween(pointA, vertex, pointB);

        results.push({
            jointIndex: def.jointIndex,
            label: def.label,
            degrees,
            vertex,
            pointA,
            pointB,
            startAngle,
            sweepAngle,
        });
    }

    return results;
};

/**
 * Compute body lean/tilt — angle of torso from vertical.
 */
export const computeBodyLean = (pose: Point2D[]): BodyLean | null => {
    if (pose.length < 25) return null;

    const shoulderMid = midpoint(pose[L_SHOULDER], pose[R_SHOULDER]);
    const hipMid = midpoint(pose[L_HIP], pose[R_HIP]);

    if (!isVisible(shoulderMid) || !isVisible(hipMid)) return null;

    // atan2(dx, dy) gives angle from vertical (positive Y is down in screen coords)
    const dx = shoulderMid.x - hipMid.x;
    const dy = hipMid.y - shoulderMid.y; // Invert because screen Y is flipped

    const angleRad = Math.atan2(dx, dy);
    const angleDeg = angleRad * (180 / Math.PI);

    return {
        angleDeg,
        shoulderMid,
        hipMid,
    };
};

/**
 * Jump height tracker — maintains rolling baseline and computes displacement.
 */
export interface JumpHeightState {
    /** Rolling history of CoG Y positions for baseline calculation */
    cogYHistory: number[];
    /** Timestamp of each entry */
    timestamps: number[];
    /** Current baseline Y (lowest CoG in window) */
    baselineY: number;
}

export const createJumpHeightState = (): JumpHeightState => ({
    cogYHistory: [],
    timestamps: [],
    baselineY: Infinity,
});

const BASELINE_WINDOW_MS = 3000; // 3-second rolling window
const JUMP_THRESHOLD_FRACTION = 0.03; // 3% of frame height to count as a jump

/**
 * Update jump height state and compute current jump height.
 * Returns null if not currently airborne.
 */
export const updateJumpHeight = (
    state: JumpHeightState,
    cog: CenterOfGravity,
    frameHeight: number,
    currentTimeMs: number
): JumpHeight | null => {
    // Add current observation
    state.cogYHistory.push(cog.y);
    state.timestamps.push(currentTimeMs);

    // Prune old entries outside the rolling window
    const cutoff = currentTimeMs - BASELINE_WINDOW_MS;
    while (state.timestamps.length > 0 && state.timestamps[0] < cutoff) {
        state.timestamps.shift();
        state.cogYHistory.shift();
    }

    // Compute baseline as the 85th percentile Y (highest Y = lowest physical point)
    // This avoids using jump peaks as baseline
    if (state.cogYHistory.length < 5) return null;

    const sorted = [...state.cogYHistory].sort((a, b) => a - b);
    const p85Index = Math.floor(sorted.length * 0.85);
    state.baselineY = sorted[p85Index];

    // Height = baseline - current (positive when jumping, since Y increases downward)
    const heightPx = state.baselineY - cog.y;
    const heightFraction = heightPx / frameHeight;

    if (heightFraction < JUMP_THRESHOLD_FRACTION) return null;

    return {
        heightPx,
        heightFraction,
        cogPosition: cog,
        baselineY: state.baselineY,
    };
};
