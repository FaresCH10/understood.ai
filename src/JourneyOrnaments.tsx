/** Decorative linework: ribbon folds, signal bars and Gulf geometric patterns. */
export function JourneyOrnaments(){
  return <div className="journey-ornaments" aria-hidden="true">
    <svg className="journey-ornament journey-ornament--ribbon" viewBox="0 0 440 440" fill="none" focusable="false">
      {[0,24,48,72,96].map(inset=><path key={inset} d={`M ${30+inset} -35 V 135 Q ${30+inset} ${340-inset} 235 ${340-inset} H 470`}/>)}
    </svg>
    <svg className="journey-ornament journey-ornament--weave" viewBox="0 0 360 360" fill="none" focusable="false">
      <g transform="translate(180 180)">{[0,45].map(angle=><g key={angle} transform={`rotate(${angle})`}><rect x="-112" y="-112" width="224" height="224"/><rect x="-91" y="-91" width="182" height="182"/></g>)}<path d="M0-180V-126M0 126V180M-180 0H-126M126 0H180"/><path d="M0-60 60 0 0 60-60 0Z"/></g>
    </svg>
    <svg className="journey-ornament journey-ornament--echo" viewBox="0 0 400 500" fill="none" focusable="false">
      {[0,22,44,66].map(inset=><path key={inset} d={`M 430 ${45+inset} H 245 Q ${45+inset} ${45+inset} ${45+inset} 245 V 530`}/>)}
    </svg>
    <svg className="journey-ornament journey-ornament--signal" viewBox="0 0 180 100" fill="none" focusable="false">
      {[24,48,76,100,76,48,24].map((height,index)=><rect key={index} x={index*25+3} y={(100-height)/2} width="10" height={height} rx="5"/>)}
    </svg>
    <svg className="journey-ornament journey-ornament--seal" viewBox="0 0 200 200" fill="none" focusable="false">
      <g transform="translate(100 100)"><rect x="-55" y="-55" width="110" height="110"/><rect x="-55" y="-55" width="110" height="110" transform="rotate(45)"/><path d="M0-34 34 0 0 34-34 0Z"/></g>
    </svg>
  </div>;
}
