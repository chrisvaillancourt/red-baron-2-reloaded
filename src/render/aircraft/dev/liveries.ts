/** Famous/sample liveries for the hangar harness (dev only). */
import type { Livery } from '../../../core/types';

export const SAMPLE_LIVERIES: Record<string, Livery> = {
  'Richthofen (all red)': { fuselage: '#a3161a', wingTop: '#a3161a', wingBottom: '#a3161a', tail: '#a3161a', cowling: '#a3161a', accent: '#a3161a', insignia: 'iron-cross-patee', pattern: 'plain' },
  'Richthofen 1918 (Balkenkreuz)': { fuselage: '#a3161a', wingTop: '#a3161a', wingBottom: '#a3161a', tail: '#f1eee4', cowling: '#a3161a', accent: '#a3161a', insignia: 'balkenkreuz', pattern: 'plain' },
  'Jasta 11 Albatros': { fuselage: '#a3161a', wingTop: '#6c7442', wingBottom: '#a9bccb', tail: '#a3161a', cowling: '#a3161a', accent: '#e8d23a', insignia: 'iron-cross-patee', pattern: 'streaked', marking: '4' },
  'Voss Dr.I (streaked, face cowl)': { fuselage: '#5f6b3d', wingTop: '#5f6b3d', wingBottom: '#9fb6c6', tail: '#f1eee4', cowling: '#d8b92a', accent: '#d8b92a', insignia: 'iron-cross-patee', pattern: 'streaked' },
  'Jasta 18 D.VII (lozenge)': { fuselage: '#1d3f8f', wingTop: '#3e4a2d', wingBottom: '#9fb0c0', tail: '#d11c1c', cowling: '#d11c1c', accent: '#d11c1c', insignia: 'balkenkreuz', pattern: 'lozenge', marking: 'R' },
  'Varnished Albatros': { fuselage: '#b58c55', wingTop: '#6c7442', wingBottom: '#a9bccb', tail: '#b58c55', cowling: '#a3a39b', accent: '#b58c55', insignia: 'iron-cross-patee', pattern: 'streaked' },
  'RFC PC10': { fuselage: '#5d563a', wingTop: '#5d563a', wingBottom: '#d8cfae', tail: '#5d563a', cowling: '#a7a9a4', accent: '#5d563a', insignia: 'roundel-rfc', pattern: 'pc10', marking: 'B' },
  'No. 56 Sqn S.E.5a (McCudden)': { fuselage: '#5d563a', wingTop: '#5d563a', wingBottom: '#d8cfae', tail: '#5d563a', cowling: '#a7a9a4', accent: '#f1eee4', insignia: 'roundel-rfc', pattern: 'pc10', marking: 'G' },
  'Guynemer "Vieux Charles"': { fuselage: '#b9b7a3', wingTop: '#b9b7a3', wingBottom: '#cfccb6', tail: '#b9b7a3', cowling: '#a7a9a4', accent: '#b9b7a3', insignia: 'roundel-france', pattern: 'plain', marking: '2' },
  'Rickenbacker 94th Aero': { fuselage: '#6d6446', wingTop: '#6d6446', wingBottom: '#d8cfae', tail: '#6d6446', cowling: '#a7a9a4', accent: '#c12a22', insignia: 'roundel-usa', pattern: 'plain', marking: '1' },
  'Clear-doped linen': { fuselage: '#d8cba6', wingTop: '#d8cba6', wingBottom: '#dcd2b2', tail: '#d8cba6', cowling: '#b0b0a8', accent: '#d8cba6', insignia: 'iron-cross-patee', pattern: 'clear-doped' },
};
