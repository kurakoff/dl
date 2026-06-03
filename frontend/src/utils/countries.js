export const COUNTRY = {
  usa:'United States', gbr:'United Kingdom', ind:'India', can:'Canada',
  aus:'Australia', deu:'Germany', fra:'France', rus:'Russia', bra:'Brazil',
  jpn:'Japan', kor:'South Korea', chn:'China', esp:'Spain', ita:'Italy',
  nld:'Netherlands', pol:'Poland', tur:'Turkey', mex:'Mexico', idn:'Indonesia',
  tha:'Thailand', ukr:'Ukraine', arg:'Argentina', zaf:'South Africa',
  phl:'Philippines', vnm:'Vietnam', pak:'Pakistan', bgd:'Bangladesh',
  egy:'Egypt', nga:'Nigeria', prt:'Portugal', swe:'Sweden', nor:'Norway',
  dnk:'Denmark', fin:'Finland', bel:'Belgium', che:'Switzerland', aut:'Austria',
  cze:'Czech Republic', svk:'Slovakia', hun:'Hungary', rou:'Romania',
  hrv:'Croatia', sgp:'Singapore', mys:'Malaysia', hkg:'Hong Kong',
  twn:'Taiwan', nzl:'New Zealand', isr:'Israel', sau:'Saudi Arabia',
  are:'United Arab Emirates', irn:'Iran', kaz:'Kazakhstan', uzb:'Uzbekistan',
  blr:'Belarus', ltu:'Lithuania', lva:'Latvia', est:'Estonia', geo:'Georgia',
  arm:'Armenia', aze:'Azerbaijan',
};

export function countryName(code) {
  return COUNTRY[code?.toLowerCase()] || code?.toUpperCase() || '—';
}
