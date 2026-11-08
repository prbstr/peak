// peak: Rho's desk rig. Printed parts that hang the body from a gas-spring
// monitor arm with the camera looking straight down at the desk.
//
// Copyright (C) 2026 the peak contributors
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version. See LICENSE at the repo root.
//
// Frame: x forward (toward the chair), y to the owner's right as he sits,
// z up. Origin: the shelf's underside, at the plate's foot, on the VESA
// centreline. The plate leans forward STOP_DEG from vertical because the
// arm's head is left resting on its face-down tilt stop, so the shelf is
// level when the plate is bolted flat to the arm's VESA plate.
//
// Render one part:  openscad -D 'part="carrier"' -o carrier.stl rig.scad
// (render.sh does them all). README.md lists what to measure first.

part = "assembly";   // assembly | carrier | pod | outrigger | micbar | pirwedge | sled | coupon | shims | ballast
$fn = 64;

// ------------------------------------------------------------------
// Measure these first (README.md, "Measure first"). Change, re-render.
// ------------------------------------------------------------------
STOP_DEG     = 30;    // the head's face-down tilt stop, degrees from vertical. 0 = plate vertical. Valid 0-40.
mic_waist    = 36;    // mic neck diameter where the ring grips it, mm
ring_len     = 15;    // ring height, must be shorter than the straight part of the neck
oled_w       = 27.3;  // OLED module outline, width
oled_h       = 27.8;  // OLED module outline, height (header edge to far edge)
oled_hole_dx = 22.3;  // OLED hole spacing across
oled_hole_dy = 23.0;  // OLED hole spacing up
oled_hole_d  = 2.8;
oled_ear     = 0;     // raises the module in Rho's head so the lit area's bottom is 10 mm above the floor
can_d        = 16;    // HC-SR04 transducer (can) diameter; the holes are can_d + 2
can_pitch    = 26;    // can centre spacing
sonar_back   = 2.5;   // tallest part on the sonar board's back (header body)
pin_hole     = 4.9;   // the 8 mm grid hole for pins and M4 bolts; the coupon picks 4.8 / 4.9 / 5.0 / 5.1
gy_pitch     = 15.5;  // GY-521 hole spacing
bar_len      = 150;   // mic bar length: sets the capsule 40-55 cm from the mouth

// ------------------------------------------------------------------
// Fixed by the parts on hand
// ------------------------------------------------------------------
shelf_x = 120;  shelf_y = 170;  shelf_t = 8;
plate_t = 6;    plate_w = 120;  plate_s = 164;   // s runs up the plate's face
vesa_s  = 70;                                     // VESA centre, up the face
nut_af  = 7.3;  nut_t = 3.4;                      // DIN 934 M4 nut pocket
m4_clear = 4.5; m4_insert = 5.4;                  // through hole; heat-set insert M4 x L5 x OD6
m25_insert = 3.2;                                 // heat-set insert M2.5 x L4 x OD3.5
pi_x0 = 36; pi_y0 = -44.5;                        // Pi 3B corner (SD edge toward the plate, HDMI/CSI edge to the right)
pi_holes = [[3.5,3.5],[61.5,3.5],[3.5,52.5],[61.5,52.5]];
pod_at = [55, 0];                                 // lens position under the shelf
pod_pulls = [[-26,-38],[-26,38],[26,22]];         // pod boss positions, pod frame (lens = origin)
grid_x = [for (i=[1:14]) i*8];                    // the 8 mm grid on the wings
grid_y = [64, 72, 80];
horn_x = [44, 64];

tan_s = tan(STOP_DEG);
cos_s = cos(STOP_DEG);
function plate_back_x(z)  = z*tan_s;
function plate_front_x(z) = z*tan_s + plate_t/cos_s;

// Perch (Rho's floor) on the plate's top
perch_z0 = plate_s*cos_s;                                            // top edge of the plate
perch_x  = [plate_back_x(perch_z0) - 17, plate_back_x(perch_z0) + 23]; // the bar straddles the plate's top
pocket   = [32.4, 64.3, 3.4];                                         // a real 4x8 plate glued studs-up
back_x   = perch_x[0] - 4.2;                                          // backrest, 8 thick, behind the torso

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
module rrect(size, r) {            // rounded-corner box, z from 0
  linear_extrude(size[2]) offset(r=r) offset(delta=-r) square([size[0], size[1]]);
}
module hole_x(d, h, teardrop=true) {   // hole along +x, teardrop on top for printing on its side
  rotate([0,90,0]) linear_extrude(h) union() {
    circle(d=d);
    if (teardrop) polygon([[-d/2*0.707, -d/2*0.707], [-d*0.707, 0], [-d/2*0.707, d/2*0.707]]);
  }
}
module hex_pocket(af, t) { cylinder(d=af/cos(30), h=t, $fn=6); }
module on_plate(y, s, back=0) {     // place a child on the plate's face, along its normal, `back` mm behind the back face
  rotate([0, STOP_DEG, 0]) translate([-back, y, s]) children();
}

// ------------------------------------------------------------------
// 1. Carrier
// ------------------------------------------------------------------
module carrier() {
  difference() {
    union() {
      // shelf
      translate([-20, -shelf_y/2, 0]) cube([shelf_x+20, shelf_y, shelf_t]);
      // plate, leaning
      on_plate(-plate_w/2, -30) cube([plate_t, plate_w, plate_s+30]);
      // gussets at the plate's edges
      for (y=[plate_w/2, -plate_w/2+6])
        translate([0, y, 0]) rotate([90,0,0]) linear_extrude(6) polygon([[0,2],[48,2],[20,32]]);
      // horns to lift the rig by
      for (sy=[1,-1]) {
        translate([horn_x[0], sy>0 ? 60 : -85, shelf_t-1]) cube([20, 25, 34]);
        translate([horn_x[0]+10, sy>0 ? 60 : -85, 41]) rotate([-90,0,0]) cylinder(d=20, h=25);
      }
      // perch bar on the plate's top, with 45 deg wedges down to both faces
      translate([back_x, -36, perch_z0]) cube([perch_x[1]-back_x, 72, 10]);
      translate([0, 36, 0]) rotate([90,0,0]) linear_extrude(72) {
        // front wedge: from the bar's front-bottom edge down-back to the plate's front face
        polygon([[perch_x[1], perch_z0], [plate_front_x(perch_z0), perch_z0], [front_wedge_x(), front_wedge_z()]]);
        // back wedge: from the bar's rear-bottom edge down-forward to the back face
        polygon([[back_x, perch_z0], [plate_back_x(perch_z0), perch_z0], [back_wedge_x(), back_wedge_z()]]);
      }
      // backrest behind the torso, 8 thick
      translate([back_x, -34, perch_z0+10]) cube([8, 68, 44]);
    }
    // --- cuts ---
    // nothing below the shelf's underside, nothing behind the plate's back face
    translate([-200,-200,-200]) cube([400,400,200]);
    rotate([0, STOP_DEG, 0]) translate([-300,-300,-300]) cube([300,600,900]);
    // VESA 75 and 100: through holes plus nut pockets in the front face
    for (p=[[37.5,37.5],[50,50]]) for (sy=[-1,1]) for (ss=[-1,1]) {
      on_plate(sy*p[0], vesa_s+ss*p[1], 1) rotate([0,90,0]) cylinder(d=m4_clear, h=plate_t+2);
      on_plate(sy*p[0], vesa_s+ss*p[1], -(plate_t-nut_t)) rotate([0,90,0]) hex_pocket(nut_af, nut_t+1);
    }
    // Pi 3B: M2.5 inserts in the shelf
    for (h=pi_holes) translate([pi_x0+h[0], pi_y0+h[1], shelf_t-6]) cylinder(d=m25_insert, h=7);
    // pod pull screws
    for (p=pod_pulls) translate([pod_at[0]+p[0], pod_at[1]+p[1], -1]) cylinder(d=5, h=shelf_t+2);
    // vial window over the pod's bubble level
    translate([pod_at[0]+4, 33, -1]) cylinder(d=28, h=shelf_t+2);
    // camera ribbon slot, behind the Pi
    translate([30, -10, -1]) cube([3, 20, shelf_t+2]);
    // the 8 mm grid on both wings (not under the horns)
    for (x=grid_x) for (y=grid_y) for (sy=[1,-1])
      if (!(x >= horn_x[0] && x <= horn_x[1]))
        translate([x, sy*y, -1]) cylinder(d=pin_hole, h=shelf_t+2);
    // perch pocket for the real plate
    translate([perch_x[0]+(perch_x[1]-perch_x[0]-pocket[0])/2, -pocket[1]/2, perch_z0+10-pocket[2]]) cube([pocket[0], pocket[1], pocket[2]+1]);
    // two pin holes through the backrest into Rho's Technic brick
    for (y=[-8,8]) translate([back_x-1, y, perch_z0+10+28]) hole_x(pin_hole, 10);
  }
}
// wedge geometry: 45 deg line from the bar's edge until it meets the plate face
function front_wedge_z() = (plate_t/cos_s - perch_x[1] + perch_z0) / (1 - tan_s);
function front_wedge_x() = plate_front_x(front_wedge_z());
function back_wedge_z()  = (back_x + perch_z0) / (1 + tan_s);
function back_wedge_x()  = plate_back_x(back_wedge_z());

// ------------------------------------------------------------------
// 2. Measurement pod: camera, GY-521, bubble vial. Lens at the origin,
//    z up from the flat bottom face (the datum, printed on the bed).
// ------------------------------------------------------------------
pod_h = 24;   // boss tops touch the shelf's underside
module pod() {
  difference() {
    union() {
      translate([-35, -48, 0]) rrect([70, 96, 8], 4);
      translate([-17.6, -15.5, 0]) cube([30, 31, 12]);                // camera boss
      for (p=pod_pulls) translate([p[0], p[1], 0]) cylinder(d=11, h=pod_h);
    }
    translate([-14.6, -12.7, 9]) cube([24.2, 25.4, 10]);              // camera pocket, PCB face down on the floor
    translate([-19, -9, 9.5]) cube([5, 18, 5]);                        // rear notch: the ribbon leaves flat
    translate([-10, -10, -1]) cube([20, 20, 11]);                      // lens window
    for (x=[-12.6, -0.1]) for (y=[-10.5, 10.5]) translate([x, y, 3]) cylinder(d=1.7, h=7);   // M2 pilots
    for (p=pod_pulls) translate([p[0], p[1], pod_h-12]) cylinder(d=m4_insert, h=13);         // M4 inserts, blind
    translate([8, -42.4, 6]) cube([21.4, 16.4, 3]);                    // GY-521 pocket
    for (dx=[-1,1]) translate([18.7+dx*gy_pitch/2, -34.2, 1.5]) cylinder(d=2.6, h=5);        // M3 pilots
    translate([7.7, -49, 6]) cube([22, 7, 3]);                         // its header slot, open at the edge
    translate([4, 33, 2]) cylinder(d=25.5, h=7);                       // 25 mm bullseye vial
    for (x=[-31,31]) for (y=[-10,10]) translate([x-0.8, y-2, -1]) cube([1.6, 4, 10]);   // cable-tie slots for the spare ribbon
  }
}

// ------------------------------------------------------------------
// 3. Sonar outrigger: HC-SR04+ under the right wing, cans down.
//    Carrier frame; top (mating) face at z 0, 10 thick.
// ------------------------------------------------------------------
sonar_bolts = [[24,64],[40,64]];
sonar_c = [32, 80];
module outrigger() {
  difference() {
    translate([2, 54, -10]) rrect([60, 36, 10], 3);
    for (b=sonar_bolts) {
      translate([b[0], b[1], -11]) cylinder(d=m4_clear, h=12);
      translate([b[0], b[1], -10.01]) hex_pocket(nut_af, nut_t);
    }
    // board recess, open on +y for the header
    translate([sonar_c[0]-45.5/2, sonar_c[1]-20.5/2, -(1.6+sonar_back+0.5)]) cube([45.5, 20.5+10, 6]);
    for (dx=[-1,1]) translate([sonar_c[0]+dx*can_pitch/2, sonar_c[1], -11]) cylinder(d=can_d+2, h=12);
    for (x=[5, 59]) for (y=[72, 82]) translate([x-1, y-2, -11]) cube([2, 4, 12]);   // tie slots
  }
}

// ------------------------------------------------------------------
// 4. Mic bar: on the right wing, with the C-ring at its end (vertical
//    axis, opening to the right). Carrier frame, z 8..33.
// ------------------------------------------------------------------
bar_y = 72; bar_x0 = 88;
ring_id = mic_waist + 3; ring_od = ring_id + 6;
ring_c = [bar_x0 + bar_len + ring_od/2 - 4, bar_y];
module micbar() {
  difference() {
    union() {
      translate([bar_x0, bar_y-5, shelf_t]) cube([bar_len, 10, 25]);
      for (x=[bar_x0+30, bar_x0+bar_len-36]) translate([x, bar_y, shelf_t+25]) cylinder(d=10, h=15);   // coil posts
      translate([ring_c[0], ring_c[1], shelf_t]) cylinder(d=ring_od, h=ring_len);
    }
    for (x=[bar_x0+8, bar_x0+24]) translate([x, bar_y, shelf_t-1]) cylinder(d=m4_clear, h=27);      // root bolts on grid (96,72) (112,72)
    translate([ring_c[0], ring_c[1], shelf_t-1]) cylinder(d=ring_id, h=ring_len+2);
    translate([ring_c[0]-ring_id*0.85/2, ring_c[1], shelf_t-1]) cube([ring_id*0.85, ring_od, ring_len+2]);  // the C opening
    for (x=[bar_x0+50, bar_x0+90]) translate([x-2, bar_y-6, shelf_t+10]) cube([4, 12, 2]);   // tie slots
  }
}

// ------------------------------------------------------------------
// 5. PIR visor: HC-SR501 on a 45 deg face looking down at the chair,
//    two grid pins in its foot. Carrier frame, front-left wing.
// ------------------------------------------------------------------
pir_foot = [96, -80];
pir_pivot = [pir_foot[0]+3, pir_foot[1]+8, shelf_t+3];   // the visor's lower edge starts inside the foot
module pirwedge() {
  difference() {
    union() {
      translate([pir_foot[0], pir_foot[1], shelf_t]) cube([24, 16, 8]);
      translate(pir_pivot) rotate([0,45,0]) translate([-5, -18, 0]) cube([5, 36, 36]);
    }
    for (x=[8,16]) translate([pir_foot[0]+x, pir_foot[1]+8, shelf_t-1]) cylinder(d=pin_hole, h=10);
    translate(pir_pivot) rotate([0,45,0]) {
      translate([-6, 0, 21]) rotate([0,90,0]) cylinder(d=24, h=8);                    // dome, through
      for (y=[-14,14]) translate([-6, y, 21]) rotate([0,90,0]) cylinder(d=1.7, h=8);  // M2 pilots, 28 apart, through
    }
    translate([-100,-200,-100]) cube([400,400,100+shelf_t-0.01]);   // nothing below the shelf top
  }
}

// ------------------------------------------------------------------
// 6. OLED sled for Rho's head. Flat, pegs up.
// ------------------------------------------------------------------
module sled() {
  w = oled_w + 4.3; h = oled_h + 0.3;
  difference() {
    union() {
      cube([w, h + oled_ear, 2]);
      for (dx=[-1,1]) for (dy=[-1,1])
        translate([w/2+dx*oled_hole_dx/2, oled_ear + h/2 + dy*oled_hole_dy/2, 2]) cylinder(d=oled_hole_d-0.2, h=3);
    }
    translate([(w-oled_w-0.3)/2, oled_ear, 1]) cube([oled_w+0.3, h+1, 2]);   // module pocket, 1 deep
    translate([w/2-6, -1, -1]) cube([12, 5+oled_ear, 4]);                     // header notch at the bottom
  }
}

// ------------------------------------------------------------------
// 7. Fit coupon: print first on the same spool and settings.
// ------------------------------------------------------------------
module coupon() {
  difference() {
    union() {
      cube([70, 36, 8]);
      translate([58, 0, 8]) cube([12, 36, 12]);     // a tab for the horizontal pin hole
    }
    for (i=[0:3]) translate([6+i*8, 7, -1]) cylinder(d=4.8+i*0.1, h=10);       // 4.8 4.9 5.0 5.1: which grips a pin
    translate([38, 7, -1]) cylinder(d=m25_insert, h=10);                         // M2.5 insert bore
    translate([46, 7, -1]) cylinder(d=m4_insert, h=10);                          // M4 insert bore
    translate([54, 7, -1]) cylinder(d=m4_clear, h=10);                           // M4 clearance
    translate([8, 24, -1]) cylinder(d=5, h=10);                                  // pod pull clearance
    translate([18, 24, 4.6]) hex_pocket(nut_af, 4);                              // nut pocket
    translate([38, 23, -1]) cylinder(d=can_d+2, h=10);                           // a sonar can must pass with daylight round it
    translate([57, 18, 14]) hole_x(pin_hole, 14);                                // the backrest's horizontal pin hole
  }
}

// ------------------------------------------------------------------
// 8. Shim washers for trimming the pod: 4 each of 0.4, 0.8, 1.6
// ------------------------------------------------------------------
module shims() {
  for (i=[0:3]) for (j=[0:2])
    translate([i*14, j*14, 0]) difference() { cylinder(d=11, h=[0.4,0.8,1.6][j]); translate([0,0,-1]) cylinder(d=5, h=3); }
}

// ------------------------------------------------------------------
// 9. Ballast: 120 x 120 x 20 mild steel, for a laser shop (DXF from the 2D shape)
// ------------------------------------------------------------------
module ballast2d() {
  difference() {
    offset(r=5) offset(delta=-5) square([120,120], center=true);
    circle(d=45);
    for (p=[37.5, 50]) for (sx=[-1,1]) for (sy=[-1,1]) translate([sx*p, sy*p]) circle(d=4.5);
  }
}
module ballast() { linear_extrude(20) ballast2d(); }

// ------------------------------------------------------------------
// Ghosts for the assembly picture (not printed)
// ------------------------------------------------------------------
module ghost_pi() {
  translate([pi_x0, pi_y0, shelf_t+11]) { cube([85, 56, 1.6]); translate([70, 2, 1.6]) cube([17, 14, 16]); translate([70, 20, 1.6]) cube([17, 14, 16]); translate([7, 50.5, 1.6]) cube([51, 5, 8.5]); }
  for (h=pi_holes) translate([pi_x0+h[0], pi_y0+h[1], shelf_t]) cylinder(d=5, h=11);
}
module ghost_camera() { translate([pod_at[0]-14.6, -12, -24+9]) cube([24, 24, 1.1]); translate([pod_at[0], 0, -24+1]) cylinder(d=7, h=8); }
module ghost_sonar() {
  translate([sonar_c[0]-22.5, sonar_c[1]-10, -10-(1.6+sonar_back+0.5)]) cube([45, 20, 1.6]);
  for (dx=[-1,1]) translate([sonar_c[0]+dx*can_pitch/2, sonar_c[1], -17]) cylinder(d=can_d, h=12);
}
module ghost_mic() { translate([ring_c[0], ring_c[1], shelf_t+ring_len+20]) rotate([180,0,0]) { cylinder(d=mic_waist, h=40); translate([0,0,40]) cylinder(d1=mic_waist, d2=50, h=20); translate([0,0,60]) cylinder(d=50, h=90); } }
module ghost_rho() {   // torso 8x4 studs, head 6x4 (one stud off-centre), legs over the front edge
  t = perch_z0 + 10;
  translate([perch_x[0]+3.8, -32, t]) cube([32, 64, 3.2+4*9.6+3.2]);
  translate([perch_x[0]+3.8, -16, t+3.2+4*9.6+3.2]) cube([32, 48, 3*9.6+6.4]);
  for (y=[-28, 12]) translate([perch_x[0]+3.8+32, y, t+3.2+4.8-28]) cube([8, 8, 28]);
}
module ghost_arm() {   // the arm's X-plate and the steel ballast behind the carrier
  on_plate(0, vesa_s, 20) rotate([0,90,0]) linear_extrude(20) ballast2d();
  on_plate(0, vesa_s, 22.5) rotate([0,90,0]) linear_extrude(2.5) { rotate(45) square([150, 40], center=true); rotate(-45) square([150, 40], center=true); }
}
module ghost_breadboard() { on_plate(-41, 45) translate([plate_t, 0, 0]) cube([10, 82, 55]); }
module ghost_lego_plate() { translate([perch_x[0]+3.8, -32, perch_z0+10-3.4]) cube([32, 64, 3.2]); }

module assembly() {
  color("gainsboro") carrier();
  color("lightsteelblue") translate([pod_at[0], pod_at[1], -pod_h]) pod();
  color("lightsteelblue") outrigger();
  color("lightsteelblue") micbar();
  color("lightsteelblue") pirwedge();
  color("darkseagreen", 0.9) ghost_pi();
  color("darkseagreen", 0.9) ghost_camera();
  color("royalblue", 0.9) ghost_sonar();
  color("dimgray", 0.8) ghost_mic();
  color("gold", 0.8) ghost_rho();
  color("gold", 0.8) ghost_lego_plate();
  color("slategray", 0.6) ghost_arm();
  color("white", 0.7) ghost_breadboard();
}

if (part == "assembly") assembly();
else if (part == "carrier") carrier();
else if (part == "pod") pod();
else if (part == "outrigger") translate([0,0,10]) outrigger();   // baffle face (cans' side) on the bed, recess open on top
else if (part == "micbar") translate([0,0,-shelf_t]) micbar();
else if (part == "pirwedge") translate([0,0,-shelf_t]) pirwedge();
else if (part == "sled") sled();
else if (part == "coupon") coupon();
else if (part == "shims") shims();
else if (part == "ballast") ballast();
else if (part == "ballast2d") ballast2d();   // for the DXF
