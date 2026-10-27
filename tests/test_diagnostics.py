from poker_agent.diagnostics import propose_selectors

def test_candidates_are_only_suggestions():
    s={'controls':[{'index':0,'tag':'button','text':'Fold','visible':True},
                   {'index':1,'tag':'button','text':'Call 10','visible':True},
                   {'index':2,'tag':'button','text':'Fold','visible':False}]}
    result=propose_selectors(s)
    assert len(result['fold_button']) == 1
    assert result['call_button'][0]['index'] == 1
    assert result['raise_button'] == []
