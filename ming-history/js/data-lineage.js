/* 明史资料平台 · 皇族世系图
   原创整理。世系关系、庙号、名讳、生卒与在位起止为史实性信息，说明文字为原创。
   不收录任何书籍正文。 */
window.MING_CORE = window.MING_CORE || {};

window.MING_CORE.LINEAGE = {
  intro:
    "明代的皇位继承远不是一条直线。十六帝之中，有以叔夺侄（靖难），有以藩王入继（世宗、光宗一支），" +
    "有兄终弟及（代宗），也有因无嗣而转入旁支（武宗之后）。把继承关系画出来，" +
    "才能看清「大礼议」为什么会在嘉靖初年爆发，以及南明诸帝为什么各自都觉得自己最有资格。",
  trees: [
    {
      id:"ming", title:"明朝帝系", span:"1368—1644",
      note:"加粗者为实际即位称帝者；灰底为追尊或未即位者。虚线表示继承关系中的特殊情形。",
      roots:[
        { name:"朱元璋", title:"太祖", era:"洪武", span:"1368—1398", reign:true, gen:1,
          note:"布衣起家，逐元建明。",
          children:[
            { name:"朱标", title:"懿文太子", era:"", span:"1355—1392", reign:false, gen:2,
              note:"太子早逝，未及即位，其子建文即位后追尊为兴宗。",
              children:[
                { name:"朱允炆", title:"惠帝", era:"建文", span:"1399—1402", reign:true, gen:3,
                  note:"太祖指定的继承人。靖难之役后下落不明，为明代第一悬案。", children:[] },
              ] },
            { name:"朱棣", title:"成祖", era:"永乐", span:"1403—1424", reign:true, gen:2,
              note:"以藩王起兵夺位（靖难之役），是明代唯一以叔夺侄而成功者。",
              children:[
                { name:"朱高炽", title:"仁宗", era:"洪熙", span:"1425", reign:true, gen:3,
                  note:"在位不足一年。",
                  children:[
                    { name:"朱瞻基", title:"宣宗", era:"宣德", span:"1426—1435", reign:true, gen:4,
                      note:"仁宣之治的完成者。",
                      children:[
                        { name:"朱祁镇", title:"英宗", era:"正统 / 天顺", span:"1436—1449 / 1457—1464", reign:true, gen:5,
                          note:"一帝两度在位、两个年号，明代仅此一例。土木之变中被俘，复辟后改元天顺。",
                          children:[
                            { name:"朱见深", title:"宪宗", era:"成化", span:"1465—1487", reign:true, gen:6,
                              note:"设西厂，内廷势力扩张。",
                              children:[
                                { name:"朱祐樘", title:"孝宗", era:"弘治", span:"1488—1505", reign:true, gen:7,
                                  note:"史称弘治中兴。",
                                  children:[
                                    { name:"朱厚照", title:"武宗", era:"正德", span:"1506—1521", reign:true, gen:8,
                                      note:"无子，皇位自此转入旁支。", children:[] },
                                  ] },
                                { name:"朱祐杬", title:"兴献王", era:"追尊睿宗", span:"1476—1519", reign:false, gen:7,
                                  note:"武宗无子，其子厚熜以藩王入继大统，由此引发「大礼议」。",
                                  children:[
                                    { name:"朱厚熜", title:"世宗", era:"嘉靖", span:"1522—1566", reign:true, gen:8,
                                      note:"以外藩入继，通过大礼议重塑皇权。",
                                      children:[
                                        { name:"朱载坖", title:"穆宗", era:"隆庆", span:"1567—1572", reign:true, gen:9,
                                          note:"隆庆开关与俺答封贡皆在此期。",
                                          children:[
                                            { name:"朱翊钧", title:"神宗", era:"万历", span:"1573—1620", reign:true, gen:10,
                                              note:"明代在位最久。此后皇位分为光宗、福王、桂王三支，南明诸帝皆出其下。",
                                              children:[
                                                { name:"朱常洛", title:"光宗", era:"泰昌", span:"1620", reign:true, gen:11,
                                                  note:"在位仅一月。",
                                                  children:[
                                                    { name:"朱由校", title:"熹宗", era:"天启", span:"1621—1627", reign:true, gen:12,
                                                      note:"无子。魏忠贤专权于此时。", children:[] },
                                                    { name:"朱由检", title:"思宗", era:"崇祯", span:"1628—1644", reign:true, gen:12,
                                                      note:"明朝最后一位全国性君主。李自成入京后自缢于煤山。", children:[] },
                                                  ] },
                                                { name:"朱常洵", title:"福王", era:"追尊恭宗", span:"1586—1641", reign:false, gen:11,
                                                  note:"神宗第三子，就藩洛阳，明末为李自成军所杀。",
                                                  children:[
                                                    { name:"朱由崧", title:"安宗", era:"弘光", span:"1645", reign:true, gen:12,
                                                      note:"在南京即位，南明第一个政权。", children:[] },
                                                  ] },
                                                { name:"朱常瀛", title:"桂王", era:"追尊礼宗", span:"1597—1645", reign:false, gen:11,
                                                  note:"就藩衡州。",
                                                  children:[
                                                    { name:"朱由榔", title:"昭宗", era:"永历", span:"1647—1662", reign:true, gen:12,
                                                      note:"南明延续最久的政权。退入缅甸后于昆明被缢杀，明郑仍奉其正朔。", children:[] },
                                                  ] },
                                              ] },
                                          ] },
                                      ] },
                                  ] },
                              ] },
                          ] },
                        { name:"朱祁钰", title:"代宗", era:"景泰", span:"1450—1457", reign:true, gen:5,
                          note:"宣宗次子、英宗之弟。土木之变后即位，夺门之变后被废。", children:[] },
                      ] },
                  ] },
              ] },
          ] },
      ],
    },
    {
      id:"nanming", title:"南明帝系与监国", span:"1644—1662",
      note:"南明诸政权皆源自明太祖子孙，但分属不同支系，故互争正统。唐王、鲁王两支出自太祖诸子，非神宗一系。",
      roots:[
        { name:"朱元璋", title:"太祖", era:"", span:"", reign:false, gen:1,
          note:"南明各支的共同祖先。",
          children:[
            { name:"朱桱", title:"唐定王", era:"太祖第二十三子", span:"", reign:false, gen:2,
              note:"就藩南阳，其后裔于明末先后建立隆武、绍武两政权。",
              children:[
                { name:"朱聿键", title:"绍宗", era:"隆武", span:"1645—1646", reign:true, gen:9,
                  note:"南明诸帝中最有振作气象者，然受制于郑芝龙。", children:[] },
                { name:"朱聿鐭", title:"（唐王）", era:"绍武", span:"1646—1647", reign:true, gen:9,
                  note:"隆武帝之弟，在广州即位，与永历并立，存在仅月余。", children:[] },
              ] },
            { name:"朱檀", title:"鲁荒王", era:"太祖第十子", span:"", reign:false, gen:2,
              note:"就藩兖州。其后裔朱以海于浙东称监国，未建年号。",
              children:[
                { name:"朱以海", title:"鲁王（监国）", era:"监国鲁王", span:"1645—1655", reign:true, gen:10,
                  note:"在浙东称监国而不称帝，后走依郑成功，居金门至终。", children:[] },
              ] },
          ] },
      ],
    },
    {
      id:"zheng", title:"明郑世系", span:"1661—1683",
      note:"郑氏本非皇族，因郑成功受隆武帝赐姓「朱」、封忠孝伯，故民间称「国姓爷」。明郑始终奉永历正朔，直至降清。",
      roots:[
        { name:"郑芝龙", title:"（平国公）", era:"", span:"1604—1661", reign:false, gen:1,
          note:"明末东南最大的海商与军阀，降清后被挟北上处死。",
          children:[
            { name:"郑成功", title:"延平王 / 国姓爷", era:"赐姓朱", span:"1624—1662", reign:true, gen:2,
              note:"1661 年进兵台湾，次年逐荷兰人。仍奉永历年号。",
              children:[
                { name:"郑经", title:"延平王", era:"奉永历正朔", span:"1642—1681", reign:true, gen:3,
                  note:"经营台湾，设府县、通商海外，三藩之乱时曾西征福建。",
                  children:[
                    { name:"郑克臧", title:"（监国）", era:"", span:"1664—1681", reign:false, gen:4,
                      note:"郑经去世后被冯锡范等所杀，未能继位。", children:[] },
                    { name:"郑克塽", title:"延平王", era:"永历三十七年", span:"1670—1707", reign:true, gen:4,
                      note:"1683 年施琅攻台，郑克塽降清，明郑结束，明代政治实体至此终结。", children:[] },
                  ] },
              ] },
          ] },
      ],
    },
  ],
  notes:[
    { t:"宗室分封与「藩禁」", d:
      "明太祖大封诸子为藩王，分镇要害，初期握有兵权（如燕王朱棣、宁王朱权）。靖难之后，" +
      "成祖深知藩王之患，逐步削夺其军权与行政权，只保留优厚俸禄与名义封号，形成「分封而不锡土、列爵而不临民、食禄而不治事」的格局。" +
      "此后宗室人口不断膨胀，至明末已逾十万，其俸禄成为地方财政的沉重负担。" },
    { t:"为什么南明会有多个「正统」", d:
      "明代皇位继承以「父死子继」为原则，兄终弟及属变例，以旁支入继则更需在礼制上自证合法。" +
      "崇祯帝自缢后，其子皆未能南下，皇位遂在神宗诸孙之间展开竞争：福王系（弘光）、桂王系（永历）各有依据，" +
      "而唐王系（隆武、绍武）则强调自己同为太祖之后。这种「多重合法性」正是南明内耗的制度根源。" },
    { t:"「大礼议」的世系背景", d:
      "武宗朱厚照无子而崩，皇位依「兄终弟及」原则传给堂弟朱厚熜（兴献王之子）。" +
      "问题在于：世宗即位后应称孝宗为「皇考」，还是称生父兴献王为「皇考」？" +
      "这一礼学分歧演变为长达数年的政治斗争，最终世宗获胜，追尊生父为帝。看世系图即可明白，" +
      "世宗与武宗只是堂兄弟，其皇位合法性确实依赖于对礼制的重新解释。" },
  ],
};
