// Made-up test network: every ID, name and value is invented. It exercises parser quirks: a header with a line
// break and a bracketed alias, constant edge type and importance, one pair in both directions, commas inside a name.
export const LOOKALIKE_LINKS_CSV = `Source,Target,Edge type,Edge importance,"Source edge importance
(Source asset importance)","Target edge importance
(Target asset importance)"
XD_AA,XS_Q,Type A,1,2,2
XD_AB,XS_P,Type A,1,3,3
XD_AB,XS_Q,Type A,1,3,2
XD_AC,XS_P,Type A,1,2,3
XD_AC,XS_R,Type A,1,2,1
XD_AD,XS_R,Type A,1,1,1
XD_AE,XS_P,Type A,1,2,3
XD_AE,XS_Q,Type A,1,2,2
XD_AE,XS_T1,Type A,1,2,2
XD_AF1,XS_T1,Type A,1,2,2
XD_AF2,XS_T2,Type A,1,2,2
XS_T1,XS_T2,Type A,1,2,2
XS_T2,XS_T1,Type A,1,2,2
XD_AG,XS_P,Type A,1,3,3
XD_AG,XS_T1,Type A,1,3,2
XS_P,XS_Q,Type A,1,3,2
XD_AH,XR_1,Type A,1,1,2
XR_1,XR_2,Type A,1,2,2
XR_2,XS_R,Type A,1,2,1
XD_AD,XR_2,Type A,1,1,2
`;

export const LOOKALIKE_NODES_CSV = `Node ID,Meaning,Node importance
XD_AA,Invented endpoint alpha,2
XD_AB,Invented endpoint bravo,3
XD_AC,"Invented endpoint, misc., charlie",2
XD_AD,Invented endpoint delta,1
XD_AE,Invented endpoint echo,2
XD_AF1,Invented endpoint foxtrot 1,2
XD_AF2,Invented endpoint foxtrot 2,2
XD_AG,Invented endpoint golf,3
XD_AH,Invented endpoint hotel,1
XS_P,Invented hub P,3
XS_Q,Invented hub Q,2
XS_R,Invented hub R,1
XS_T1,Invented hub T1,2
XS_T2,Invented hub T2,2
XR_1,XR_1,2
XR_2,Xr_2,2
`;
