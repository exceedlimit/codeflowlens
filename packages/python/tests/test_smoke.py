def test_import():
    """개요: 패키지가 import되고 버전이 있는지 확인한다."""
    import flowlens

    assert flowlens.__version__
