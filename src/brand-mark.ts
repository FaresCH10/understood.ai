// Traced from the supplied brand symbol. The wordmark is deliberately excluded.
// One coordinate system is shared by the finished mark and its ribbon choreography.
export const brandMark = {
  viewBox:'-58 -62 482 354',
  silhouette:'M74 0 H107 C131 0 148 19 148 43 V141 C148 164 162 178 183 178 C205 178 220 163 220 141 V43 C220 19 237 0 261 0 H292 V146 C292 199 258 234 205 234 H161 C108 234 74 199 74 146 Z',
  leftFold:'M74 0 H107 C131 0 148 19 148 43 V141 C148 164 162 178 183 178 C130 180 74 142 74 81 Z',
  frontFold:'M292 69 C292 129 236 166 184 197 C147 219 118 227 101 216 C117 228 137 234 161 234 H205 C258 234 292 199 292 146 Z',
  seam:'M101 216 C147 228 289 143 292 69',
  ribbon:'M-15 113 C37 63 93 84 143 110 C191 135 230 79 279 90 C326 99 349 123 381 93 L381 147 C348 176 315 156 274 149 C230 141 197 197 142 170 C87 142 42 120-15 167 Z',
  curling:'M71 29 C83-9 128-17 150 15 C167 40 145 88 151 131 C155 163 176 185 202 176 C225 167 222 135 224 100 C228 62 255 30 286 21 L312 44 C286 71 292 119 289 153 C286 203 257 240 207 242 C151 244 110 220 91 177 C73 137 90 86 71 66 Z',
  thread:'M-45 151 C28 57 83 76 146 106 S240 69 285 104 S356 163 406 85',
  bars:[
    {x:34,y:56,width:28,height:111,rx:14,side:'left',size:'inner'},
    {x:304,y:56,width:28,height:111,rx:14,side:'right',size:'inner'},
    {x:0,y:86,width:28,height:54,rx:14,side:'left',size:'outer'},
    {x:338,y:86,width:28,height:54,rx:14,side:'right',size:'outer'},
  ],
} as const;

export const BRAND_CYCLE_SECONDS=5.8;
export const brandChapters=[
  {at:0,label:'A single ribbon'},
  {at:.95,label:'The fold'},
  {at:2.1,label:'The U takes shape'},
  {at:3.1,label:'The signal arrives'},
  {at:4.4,label:'Everything, understood'},
] as const;
